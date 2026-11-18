import type { OwnerTaskView } from './owner-task-queue.js';
export interface WorkItem { id: string; objective: string; state: string; createdAt: string | null; error: string | null }
export interface WorkSnapshot { schema: 'owner-work-queue-v1'; status: 'ready' | 'not_configured' | 'unavailable'; capturedAt: string; paused: boolean | null; windowLimit: 50; items: WorkItem[] }
const states = ['proposed','queued','running','awaiting_verification','verified','rejected','cancelled','failed'];
export function projectWorkQueue(view: OwnerTaskView, time: number): WorkSnapshot {
  if (typeof view.paused !== 'boolean' || !Array.isArray(view.tasks) || view.tasks.length > 50) throw new Error('invalid_work_queue');
  const items = view.tasks.map(t => {
    if (!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(t.id) || typeof t.objective !== 'string' || t.objective.length > 400 || !states.includes(t.state)) throw new Error('invalid_work_queue');
    const time = t.created_at instanceof Date ? t.created_at.getTime() : Date.parse(t.created_at);
    return { id: t.id, objective: t.objective, state: t.state, createdAt: Number.isFinite(time) ? new Date(time).toISOString() : null, error: typeof t.error_code === 'string' ? t.error_code.slice(0,128) : null };
  });
  return { schema:'owner-work-queue-v1', status:'ready', capturedAt:new Date(time).toISOString(), paused:view.paused, windowLimit:50, items };
}
/** Per-app, single-owner read cache. No task results, command keys, or mutations. */
export function createWorkQueueReader(store?: { view(): Promise<OwnerTaskView> }, now: () => number = Date.now) {
  let cached: WorkSnapshot | undefined, until = 0, pending: Promise<WorkSnapshot> | undefined;
  return (): Promise<WorkSnapshot> => {
    const absent = (status: 'not_configured' | 'unavailable'): WorkSnapshot => ({schema:'owner-work-queue-v1',status,capturedAt:new Date(now()).toISOString(),paused:null,windowLimit:50,items:[]});
    if (!store) return Promise.resolve(absent('not_configured'));
    if (cached && now() < until) return Promise.resolve(cached);
    if (pending) return pending;
    pending = (async () => {
      try { cached = projectWorkQueue(await store.view(),now()); }
      catch { cached = absent('unavailable'); }
      until = now()+2000;
      return cached;
    })().finally(() => { pending = undefined; });
    return pending;
  };
}
export interface QueueClientState { phase: 'loading' | 'ready' | 'stale' | 'unavailable' | 'disabled' | 'expired'; lastGoodAt: string | null; failures: number }
export function transitionQueue(previous: QueueClientState, event: { type: 'ready' | 'failure' | 'disabled' | 'expired'; at?: string }): QueueClientState {
  if (event.type === 'expired') return {phase:'expired',lastGoodAt:null,failures:0};
  if (event.type === 'disabled') return {phase:'disabled',lastGoodAt:null,failures:0};
  if (event.type === 'ready') return {phase:'ready',lastGoodAt:event.at ?? null,failures:0};
  return {phase:previous.lastGoodAt ? 'stale' : 'unavailable',lastGoodAt:previous.lastGoodAt,failures:previous.failures+1};
}
/** Compiled reducer is embedded in the client so tests and browser use the same transitions. */
export const workQueueJs = `(()=>{'use strict';const root=document.querySelector('[data-work-queue]');if(!root)return;const transition=${transitionQueue.toString()};const rows=root.querySelector('[data-queue-rows]'),status=root.querySelector('[data-queue-status]'),retry=root.querySelector('[data-queue-retry]');let state={phase:root.dataset.queuePhase||'loading',lastGoodAt:root.dataset.queueCaptured||null,failures:0},timer,controller,busy=false,stopped=false;const terminal=['verified','cancelled'];function announce(){root.dataset.queuePhase=state.phase;status.textContent=state.phase==='ready'?'Current snapshot: '+state.lastGoodAt:state.phase==='stale'?'Refresh failed. Showing stale records from '+state.lastGoodAt:state.phase==='disabled'?'Task store is not configured. This is not zero tasks.':state.phase==='expired'?'Session expired. Sign in again; prior rows have been cleared.':'Task records unavailable. This is not zero tasks.';}function render(snapshot){rows.replaceChildren();const items=snapshot.items.filter(t=>!terminal.includes(t.state));if(!items.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=5;td.textContent='No actionable tasks in the returned window of up to 50 records.';tr.append(td);rows.append(tr);}for(const item of items){const tr=document.createElement('tr');for(const value of [item.objective,item.state,item.createdAt||'Unknown',item.error||'None recorded']){const td=document.createElement('td');td.textContent=value;tr.append(td);}const td=document.createElement('td'),a=document.createElement('a');a.href='/?view=tasks';a.textContent=item.state==='proposed'?'Review proposal':'Inspect task';td.append(a);tr.append(td);rows.append(tr);}}function valid(s){return s&&s.schema==='owner-work-queue-v1'&&['ready','not_configured','unavailable'].includes(s.status)&&typeof s.capturedAt==='string'&&Number.isFinite(Date.parse(s.capturedAt))&&Array.isArray(s.items)&&s.items.length<=50&&s.items.every(t=>t&&typeof t.id==='string'&&typeof t.objective==='string'&&t.objective.length<=400&&typeof t.state==='string');}async function poll(){if(stopped||busy||document.hidden)return;clearTimeout(timer);busy=true;controller=new AbortController();const deadline=setTimeout(()=>controller.abort(),12000);try{const response=await fetch('/api/work-queue',{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'},signal:controller.signal});if(response.status===401){state=transition(state,{type:'expired'});rows.replaceChildren();stopped=true;}else{if(!response.ok)throw Error('read_failed');const snapshot=await response.json();if(!valid(snapshot)||snapshot.status==='unavailable')throw Error('invalid_or_unavailable');state=transition(state,{type:snapshot.status==='ready'?'ready':'disabled',at:snapshot.capturedAt});if(snapshot.status==='ready')render(snapshot);else rows.replaceChildren();}announce();}catch{if(!stopped&&!document.hidden){state=transition(state,{type:'failure'});announce();}}finally{clearTimeout(deadline);busy=false;if(!stopped&&!document.hidden)timer=setTimeout(poll,Math.min(60000,5000*Math.pow(2,Math.min(state.failures,4))));}}retry.addEventListener('click',poll);document.addEventListener('visibilitychange',()=>{clearTimeout(timer);if(document.hidden){if(controller)controller.abort();}else poll();});window.addEventListener('pagehide',()=>{stopped=true;clearTimeout(timer);if(controller)controller.abort();});poll();})();`;
