import { describe, expect, it } from 'vitest';
import { scryptSync } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { createOwnerControlApp } from './owner-app.js';
import { OWNER_TASK_POLICY, type OwnerTaskView } from './owner-task-queue.js';
import { projectWorkQueue, transitionQueue, createWorkQueueReader } from './owner-work-queue.js';
import { renderWorkspace, adaptOwnerPage, workspaceNavigation } from './owner-workspace.js';
const view: OwnerTaskView={paused:true,policy:OWNER_TASK_POLICY,tasks:[{id:'00000000-0000-4000-8000-000000000001',command_key:'private-command',objective:'<proposal>',baseline_revision:'a'.repeat(40),state:'proposed',attempts:0,worker_id:null,verifier_id:null,error_code:null,result:{private:'result-marker'},created_at:'2026-11-01T00:00:00.000Z'}],events:[]};
describe('shared owner workspace and work queue',()=>{
  it('projects bounded records without private command or result fields',()=>{
    const snapshot=projectWorkQueue(view,0);expect(snapshot.items).toHaveLength(1);expect(JSON.stringify(snapshot)).not.toContain('private-command');expect(JSON.stringify(snapshot)).not.toContain('result-marker');
    expect(()=>projectWorkQueue({...view,tasks:Array(51).fill(view.tasks[0])},0)).toThrow();
  });
  it('distinguishes stale, unavailable, disabled and expired session states',()=>{
    const initial={phase:'loading' as const,lastGoodAt:null,failures:0};expect(transitionQueue(initial,{type:'failure'}).phase).toBe('unavailable');
    const good=transitionQueue(initial,{type:'ready',at:'time'});expect(transitionQueue(good,{type:'failure'}).phase).toBe('stale');expect(transitionQueue(good,{type:'expired'}).lastGoodAt).toBeNull();expect(transitionQueue(good,{type:'disabled'}).phase).toBe('disabled');
  });
  it('coalesces concurrent queue reads and caches a short snapshot',async()=>{
    let reads=0;const read=createWorkQueueReader({view:async()=>{reads++;return view;}},()=>0);await Promise.all([read(),read(),read()]);expect(reads).toBe(1);await read();expect(reads).toBe(1);
    expect((await createWorkQueueReader()()).status).toBe('not_configured');expect((await createWorkQueueReader({view:async()=>{throw Error('secret');}})()).status).toBe('unavailable');
  });
  it('renders all navigation destinations with exactly one active item',()=>{
    for(const [active] of workspaceNavigation){const html=renderWorkspace('<p>Content</p>',{active,csrf:'token',expires:900000,revision:'a'.repeat(40),time:0});expect(html.match(/aria-current="page"/g)).toHaveLength(1);expect(html.match(/<main\b/g)).toHaveLength(1);expect(html).toContain('<details data-workspace-diagnostics>');expect(html).not.toContain('<details open');for(const [,href]of workspaceNavigation)expect(html).toContain('href="'+href+'"');}
  });
  it('adapts only a supported legacy main shape and is idempotent',()=>{
    const c={active:'services',csrf:'token',expires:900000,revision:'a'.repeat(40),time:0};expect(()=>adaptOwnerPage('<main>one</main><main>two</main>',c)).toThrow();const html=adaptOwnerPage('<html><main><p>trusted</p></main></html>',c);expect(adaptOwnerPage(html,c)).toBe(html);
  });
  it('requires authentication for queue reads and renders actual stored records',async()=>{
    const password='synthetic-workspace-password',saltHex='12'.repeat(16),origin='https://owner.example.test';let reads=0;
    const deny=async():Promise<never>=>{throw Error('unexpected mutation');};
    const app=createOwnerControlApp({owner:'owner',origin,saltHex,hashHex:scryptSync(password,Buffer.from(saltHex,'hex'),64).toString('hex'),revision:'a'.repeat(40)},Date.now,{view:async()=>{reads++;return view;},propose:deny,approve:deny,cancel:deny,pause:deny});
    const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
    try{const base='http://127.0.0.1:'+(server.address() as AddressInfo).port;expect((await fetch(base+'/api/work-queue')).status).toBe(401);expect(reads).toBe(0);
      const login=await fetch(base+'/login',{method:'POST',redirect:'manual',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({owner:'owner',password})});const Cookie=login.headers.get('set-cookie')!.split(';')[0];
      const response=await fetch(base+'/api/work-queue',{headers:{Cookie}});expect(response.status).toBe(200);expect((await response.json()).status).toBe('ready');
      const html=await(await fetch(base+'/',{headers:{Cookie}})).text();expect(html).toContain('&lt;proposal&gt;');expect(html).toContain('data-owner-shell="shared-v1"');expect(html).toContain('/assets/work-queue.js');expect(html).not.toContain('result-marker');
    }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  });
});
