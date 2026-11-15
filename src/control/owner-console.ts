import { proposedServices } from '../agent-services/registry.js';
import type { OwnerTaskView } from './owner-task-queue.js';
import type { OwnerGovernanceAgent, OwnerGovernanceView } from './owner-governance.js';
const blockers = [
  { area: 'Snapshot', title: 'Original-source evidence', source: 'src/agent-services/snapshot-provider.ts', acceptance: 'Retain original source excerpts and locations; do not generate evidence from parsed values.' },
  { area: 'Snapshot', title: 'Stable identity and immutable retries', source: 'src/persistence/postgres-snapshot-sink.ts', acceptance: 'Plan reordering must preserve identity. Retry-returned and persisted snapshot payloads must agree.' },
  { area: 'Comparison', title: 'Coverage trust and consistent pair reads', source: 'src/agent-commerce/worker.ts', acceptance: 'Use consistent paired reads; do not infer additions/removals from unverified complete coverage.' },
  { area: 'Network', title: 'Fetch hardening before activation', source: 'src/agent-services/safe-fetch.ts', acceptance: 'Verify normalized IPv6, bounded DNS, stream disposal, destination policy, TLS and cancellation with tests.' },
  { area: 'Identity', title: 'Commerce/snapshot ownership bridge', source: 'src/persistence/postgres-snapshot-source-store.ts', acceptance: 'Establish and test buyer/resource registration across the two persistence boundaries.' },
  { area: 'Documents', title: 'Actual owned document extraction', source: 'src/agent-services/document-extract.ts', acceptance: 'Implement reviewed intake/parser, original field evidence, resource limits, isolation and retention.' },
  { area: 'Commerce', title: 'Authorized funding and payment recovery', source: 'src/agent-commerce/', acceptance: 'Verify buyer-authorized funding, signed webhook inbox, atomic grants, refunds, disputes and reconciliation.' },
  { area: 'Release', title: 'Receipts and trusted release evidence', source: 'src/evolution/release-gate.ts', acceptance: 'Verify failed-job receipts, independent per-service evidence, approved terms/prices and deployed end-to-end behavior.' }
] as const;
export function ownerOverview(owner: string, revision: string, time: number, expires: number, taskQueueConnected = false) {
  return { owner, configuredRevision: revision, observedAt: new Date(time).toISOString(),
    sessionExpiresAt: new Date(expires).toISOString(), serviceReadiness: 'not_evaluated',
    taskDispatch: taskQueueConnected, liveSending: false, paymentAdministration: false,
    services: proposedServices, servicesSource: 'src/agent-services/registry.ts',
    blockers, backlogBasis: 'Tracked handoff audit findings; not a fresh scan or verified remediation status.',
    runtime: { scope: 'owner process only', node: process.version, uptimeSeconds: Math.floor(process.uptime()),
      rssBytes: process.memoryUsage().rss,
      database: taskQueueConnected ? 'owner_task_queue_connected' : 'not_connected',
      workers: taskQueueConnected ? 'heartbeat_only' : 'not_connected' } };
}
export const ownerCss = `:root{--bg:#0b0f17;--surface:#111a29;--surface-2:#0e1520;--border:#1e2a3d;--border-2:#2a3a55;--text:#e6edf7;--muted:#93a4bd;--accent:#4f8cff;--accent-soft:rgba(79,140,255,.13);--accent-text:#9cc2ff;--ok:#34d399;--ok-soft:rgba(52,211,153,.13);--warn:#f6c453;--warn-soft:rgba(246,196,83,.13);--danger:#f87171;--danger-soft:rgba(248,113,113,.12);--info:#5ec2f5;--info-soft:rgba(94,194,245,.13);--mono:ui-monospace,'Cascadia Code',Menlo,Consolas,monospace;--sans:ui-sans-serif,system-ui,'Segoe UI',Roboto,sans-serif;--radius:10px;--radius-sm:7px;--shadow:0 1px 2px rgba(3,7,18,.5)}*{box-sizing:border-box}html{color-scheme:dark}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.55 var(--sans);-webkit-font-smoothing:antialiased}a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:3px}.muted{color:var(--muted)}.hint{font-size:12px;color:var(--muted);margin:6px 0}code{font-family:var(--mono);font-size:12.5px;overflow-wrap:anywhere}pre{font-family:var(--mono);font-size:12px;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px;overflow:auto;margin:8px 0}.shell{display:grid;grid-template-columns:230px minmax(0,1fr);min-height:100vh}.sidebar{position:sticky;top:0;height:100vh;display:flex;flex-direction:column;gap:18px;padding:20px 14px;background:var(--surface-2);border-right:1px solid var(--border)}.brand{display:flex;gap:10px;align-items:center;padding:4px 8px}.brand-mark{width:32px;height:32px;border-radius:8px;background:linear-gradient(135deg,var(--accent),#7c5cff);display:grid;place-items:center;color:#fff;font-weight:700;font-size:12px;flex:none}.brand-name{font-weight:650;letter-spacing:.2px;display:block}.brand-sub{font-size:11px;color:var(--muted)}.nav{display:flex;flex-direction:column;gap:2px}.nav a{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:var(--radius-sm);color:var(--muted);font-weight:550}.nav a:hover{background:rgba(255,255,255,.04);color:var(--text);text-decoration:none}.nav a[aria-current=page]{background:var(--accent-soft);color:var(--accent-text)}.sidebar-foot{margin-top:auto;display:flex;flex-direction:column;gap:10px;font-size:12px;color:var(--muted);padding:0 8px}.main{min-width:0}.topbar{display:flex;align-items:center;gap:12px;padding:14px 26px;border-bottom:1px solid var(--border);background:rgba(11,15,23,.88);position:sticky;top:0;z-index:5;backdrop-filter:blur(6px)}.topbar h1{font-size:15px;margin:0;font-weight:650;text-transform:capitalize}.spacer{flex:1}.pill{display:inline-flex;align-items:center;gap:7px;padding:4px 11px;border-radius:99px;font-size:12px;font-weight:550;border:1px solid var(--border-2);background:var(--surface);white-space:nowrap}.dot{width:7px;height:7px;border-radius:50%;flex:none}.dot--ok{background:var(--ok)}.dot--warn{background:var(--warn)}.dot--danger{background:var(--danger)}.dot--muted{background:var(--muted)}.content{padding:24px 26px;max-width:1240px}.page-head h2{font-size:18px;font-weight:650;margin:0 0 4px}.toolbar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:14px}.search{display:flex;gap:8px;flex:1;min-width:220px}.search input{flex:1}input{background:var(--surface-2);border:1px solid var(--border-2);color:var(--text);border-radius:var(--radius-sm);padding:9px 12px;font:inherit;min-width:0}input:focus{border-color:var(--accent);outline:none}.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:8px 14px;border-radius:var(--radius-sm);border:1px solid var(--border-2);background:var(--surface);color:var(--text);font:inherit;font-weight:550;cursor:pointer;text-decoration:none;white-space:nowrap}.btn:hover{border-color:var(--accent);text-decoration:none}.btn--primary{background:var(--accent);border-color:var(--accent);color:#fff}.btn--danger:hover{border-color:var(--danger);color:var(--danger)}.btn--small{padding:4px 10px;font-size:12px}.btn--block{width:100%}.flash{display:flex;gap:10px;align-items:flex-start;border:1px solid var(--danger-soft);border-left:3px solid var(--danger);background:var(--danger-soft);color:#ffd9d9;border-radius:var(--radius-sm);padding:12px 14px;margin-bottom:14px}.flash--warn{border-color:rgba(246,196,83,.3);border-left-color:var(--warn);background:var(--warn-soft);color:#f4dfa5}.stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-bottom:16px}.stat{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:15px 17px}.stat-label{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}.stat-value{font-size:23px;font-weight:650;margin-top:4px}.stat-sub{font-size:12px;color:var(--muted);margin-top:5px}.panel{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);margin-bottom:16px;overflow:hidden}.panel-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 17px;border-bottom:1px solid var(--border)}.panel-head h3{margin:0;font-size:13px;font-weight:600;letter-spacing:.02em}.panel-body{padding:15px 17px}.table-wrap{overflow:auto;border-top:1px solid var(--border)}table{border-collapse:collapse;width:100%;font-size:13px}th{position:sticky;top:0;background:var(--surface-2);text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);padding:9px 14px;border-bottom:1px solid var(--border)}td{padding:10px 14px;border-bottom:1px solid var(--border);vertical-align:top}tbody tr:hover{background:rgba(255,255,255,.025)}tbody tr:last-child td{border-bottom:none}td form{display:inline-flex;margin:2px 6px 2px 0}.num{text-align:right;font-variant-numeric:tabular-nums}.badge{display:inline-flex;align-items:center;gap:6px;padding:2px 9px;border-radius:99px;font-size:11px;font-weight:600;border:1px solid;white-space:nowrap}.badge--proposed{color:var(--info);border-color:rgba(94,194,245,.4);background:var(--info-soft)}.badge--queued{color:var(--accent-text);border-color:rgba(79,140,255,.4);background:var(--accent-soft)}.badge--running{color:var(--warn);border-color:rgba(246,196,83,.4);background:var(--warn-soft)}.badge--awaiting_verification{color:var(--warn);border-color:rgba(246,196,83,.4);background:var(--warn-soft)}.badge--verified{color:var(--ok);border-color:rgba(52,211,153,.4);background:var(--ok-soft)}.badge--rejected,.badge--cancelled,.badge--failed{color:var(--danger);border-color:rgba(248,113,113,.4);background:var(--danger-soft)}.badge--neutral{color:var(--muted);border-color:var(--border-2);background:rgba(255,255,255,.04)}.empty{padding:36px 20px;text-align:center;color:var(--muted)}.empty-title{font-weight:600;color:var(--text);margin-bottom:6px}dl.meta{display:grid;grid-template-columns:max-content 1fr;gap:7px 16px;margin:0;font-size:13px}dl.meta dt{color:var(--muted)}dl.meta dd{margin:0;overflow-wrap:anywhere}details{border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);margin-bottom:10px}details summary{cursor:pointer;padding:11px 16px;font-weight:550;display:flex;gap:10px;align-items:baseline;list-style:none}details[open] summary{border-bottom:1px solid var(--border)}details .panel-body{border-top:none}.field{display:block;margin:12px 0}.field-label{display:block;font-weight:550;margin-bottom:6px}.stack .btn{margin-top:8px}.filters{display:flex;gap:6px;flex-wrap:wrap}.filter{padding:4px 12px;border-radius:99px;border:1px solid var(--border-2);background:transparent;color:var(--muted);font:inherit;font-size:12px;cursor:pointer}.filter[aria-pressed=true]{background:var(--accent-soft);color:var(--accent);border-color:var(--accent)}.count{font-size:11px;color:var(--muted);background:rgba(255,255,255,.06);padding:1px 7px;border-radius:99px}.visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}.login-shell{min-height:100vh;display:grid;place-items:center;padding:20px;background:radial-gradient(1200px 600px at 50% -10%,rgba(79,140,255,.09),transparent),var(--bg)}.login-card{width:100%;max-width:380px;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:28px;box-shadow:var(--shadow)}.login-card h1{font-size:19px;margin:14px 0 4px}.cell-main{margin-bottom:6px;overflow-wrap:anywhere}.cell-actions{display:flex;flex-wrap:wrap;align-items:center}.note-foot{margin-top:24px;padding-top:14px;border-top:1px solid var(--border);color:var(--muted);font-size:12px;display:flex;gap:14px;flex-wrap:wrap;align-items:center}@media(max-width:900px){.shell{grid-template-columns:1fr}.sidebar{position:static;height:auto;flex-direction:row;align-items:center;flex-wrap:wrap;gap:10px;border-right:none;border-bottom:1px solid var(--border)}.nav{flex-direction:row;flex-wrap:wrap}.sidebar-foot{margin:0 0 0 auto;flex-direction:row;align-items:center}}@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}`;
export const ownerJs = `(function(){"use strict";function rel(t){var s=Math.round((Date.now()-t)/1000);if(s<45)return"just now";if(s<3600)return Math.round(s/60)+"m ago";if(s<86400)return Math.round(s/3600)+"h ago";return Math.round(s/86400)+"d ago"}document.querySelectorAll("[data-time]").forEach(function(el){var t=Date.parse(el.getAttribute("data-time"));if(Number.isFinite(t)){el.textContent=rel(new Date(t))}});var exp=document.querySelector("[data-expires]");if(exp){var tick=function(){var ms=Date.parse(exp.getAttribute("data-expires"))-Date.now();exp.textContent=ms>0?Math.ceil(ms/60000)+" min left":"session expired"};tick();setInterval(tick,15000)}document.querySelectorAll("form[data-confirm]").forEach(function(form){form.addEventListener("submit",function(e){if(!window.confirm(form.getAttribute("data-confirm")))e.preventDefault()})});document.querySelectorAll("[data-copy]").forEach(function(el){el.style.cursor="pointer";el.title="Copy";el.addEventListener("click",function(){if(navigator.clipboard){navigator.clipboard.writeText(el.getAttribute("data-copy")).then(function(){var t=el.textContent;el.textContent="copied";setTimeout(function(){el.textContent=t},1100)})}})});var rows=Array.prototype.slice.call(document.querySelectorAll("tr[data-state]"));var filters=Array.prototype.slice.call(document.querySelectorAll(".filter[data-filter]"));if(rows.length&&filters.length){filters.forEach(function(f){f.addEventListener("click",function(){var state=f.getAttribute("data-filter");var on=f.getAttribute("aria-pressed")!=="true";filters.forEach(function(g){g.setAttribute("aria-pressed",g===f&&on?"true":"false")});rows.forEach(function(r){r.hidden=on&&r.getAttribute("data-state")!==state})})})}var refresh=document.querySelector("[data-refresh]");if(refresh){var secs=Number(refresh.getAttribute("data-refresh"))||45;var busy=function(){return document.visibilityState!=="visible"||Boolean(document.querySelector("input:focus,textarea:focus,details[open]"))};setInterval(function(){if(!busy())window.location.reload()},secs*1000)}})();`;
export interface OwnerConsoleTasks {
  configured: boolean;
  view?: OwnerTaskView;
  databaseUnavailable?: boolean;
  proposeKey: string;
  governance?: { policy: OwnerGovernanceView; chainVerified: boolean; agents: OwnerGovernanceAgent[] } | { unavailable: true };
}
// Entity strings are built by concatenation so they cannot be damaged in transit.
const entities: Record<string, string> = { '&': '&' + 'amp;', '<': '&' + 'lt;', '>': '&' + 'gt;', '"': '&' + 'quot;', "'": '&' + '#39;' };
const escape = (value: unknown) => String(value).replace(/[&<>"']/g, c => entities[c]!);
function document(title: string, content: string) {
  return '<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">' + escape(title) + '<link rel=stylesheet href=/assets/owner.css><script src=/assets/owner.js defer></script></head><body>' + content + '</body></html>';
}
export function ownerLogin(error = '') {
  const messages: Record<string, string> = { unauthorized: 'Sign-in failed. Check your owner name and password.',
    origin_denied: 'Reload the login page using the exact configured HTTPS address before signing in.',
    login_limited: 'Too many sign-in attempts. Wait one minute and retry.' };
  return document('Owner login', '<div class=login-shell><div class=login-card>'
    + '<div class=brand><span class=brand-mark aria-hidden=true>CI</span><span><span class=brand-name>CodexImmortal</span><span class=brand-sub>Owner console</span></span></div>'
    + '<h1>Owner login</h1><p class=muted>Local control console. No public registration.</p>'
    + (error ? '<p class=flash role=alert>' + escape(messages[error] ?? 'Sign-in failed.') + '</p>' : '')
    + '<form method=post action=/login><label class=field><span class=field-label>Owner</span><input name=owner autocomplete=username required maxlength=100></label>'
    + '<label class=field><span class=field-label>Password</span><input name=password type=password autocomplete=current-password required maxlength=256></label>'
    + '<button class="btn btn--primary btn--block">Sign in</button></form></div></div>');
}
const when = (value: unknown) => value instanceof Date ? value.toISOString() : String(value ?? '');
const short = (value: string) => value.slice(0, 8);
const ago = (value: unknown) => { const iso = when(value); return '<time data-time="' + escape(iso) + '" title="' + escape(iso) + '">' + escape(iso) + '</time>'; };
const humanBytes = (value: unknown) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return String(value);
  if (n < 1024) return n + ' B';
  const units = ['KB', 'MB', 'GB', 'TB'];
  let i = -1, x = n;
  do { x /= 1024; i++; } while (x >= 1024 && i < units.length - 1);
  return (x >= 100 ? x.toFixed(0) : x.toFixed(1)) + ' ' + units[i];
};
const humanUptime = (seconds: number) => seconds < 60 ? seconds + 's' : Math.floor(seconds / 60) + 'm ' + (seconds % 60) + 's';
const stateBadge = (state: string) => '<span class="badge badge--' + escape(state) + '">' + escape(state) + '</span>';
function form(action: string, csrf: string, fields: string, label: string, options: { variant?: string; confirm?: string } = {}) {
  return '<form method=post action=' + action + (options.confirm ? ' data-confirm="' + escape(options.confirm) + '"' : '') + '>'
    + '<input type=hidden name=csrf value="' + escape(csrf) + '">' + fields
    + '<button class="btn btn--small' + (options.variant ? ' ' + options.variant : '') + '">' + label + '</button></form>';
}
const taskMessages: Record<string, string> = {
  owner_task_database_not_configured: 'The local task database is not configured, so this action is unavailable.',
  owner_task_database_unavailable: 'The local task database could not be reached. No task state was changed by this request.',
  owner_task_not_initialized: 'Run node dist/control/owner-task-queue.js init for the configured database first.',
  owner_governance_database_unavailable: 'The governance store could not be reached. Proposals fail closed until it is available.',
  policy_unavailable_or_tampered: 'No verifiable dispatch policy is active, so proposals fail closed.',
  invalid_task_proposal: 'Proposals need an objective label (1-400 characters) and the command key from this form.',
  invalid_task_id: 'That task reference is not a valid task identifier.',
  command_conflict: 'That command key was already used with different content.',
  task_capacity_reached: 'The unfinished-task limit (50) is reached.',
  task_transition_denied: 'That task is not in a state that allows this action.',
  owner_task_failed: 'The task action failed. Inspect the durable event history for details.'
};
function tasksPanel(csrf: string, tasks: OwnerConsoleTasks | undefined, error: string) {
  if (!tasks || !tasks.configured || tasks.databaseUnavailable || !tasks.view) {
    const reason = tasks && tasks.databaseUnavailable
      ? 'The local task database could not be read. This is a connectivity failure, not zero tasks; controls stay disabled for this snapshot.'
      : 'No local task database is configured, so no task state is shown. This is a missing-configuration state, not zero tasks.';
    return '<div class=page-head><h2>Owner tasks</h2></div><div class="flash flash--warn" role=alert>' + reason + '</div>'
      + '<section class=panel><div class=panel-body><p class=hint>Configure locally, never in chat: <code>CODEX_OWNER_TASK_DATABASE_URL</code> for a dedicated loopback PostgreSQL database named <code>codex_owner_control</code>, plus <code>CODEX_OWNER_TASK_DB_ACK=local-owner-tasks-only</code>, then run <code>node dist/control/owner-task-queue.js init</code>.</p></div></section>';
  }
  const banner = error ? '<div class=flash role=alert>' + escape(taskMessages[error] ?? 'The task action failed.') + '</div>' : '';
  let gov = '';
  if (tasks.governance) {
    if ('unavailable' in tasks.governance) {
      gov = '<section class=panel><div class=panel-head><h3>Governance</h3><span class="badge badge--rejected">unavailable</span></div><div class=panel-body><p class=hint>Governance state is unavailable, so task proposals fail closed. If the governance tables are missing, run <code>node dist/control/owner-task-queue.js init-governance</code> for the configured database.</p></div></section>';
    } else {
      const g = tasks.governance;
      gov = '<section class=panel><div class=panel-head><h3>Governance</h3><span class="badge ' + (g.chainVerified ? 'badge--verified">chain verified' : 'badge--rejected">chain not verified') + '</span></div><div class=panel-body>'
        + '<dl class=meta><dt>Active dispatch policy</dt><dd>version ' + escape(String(g.policy.version)) + ' · sha256 <code>' + escape(g.policy.documentSha256.slice(0, 16)) + '</code></dd>'
        + '<dt>Audit chain</dt><dd>' + (g.chainVerified ? 'Verified across the latest 100 governance events.' : 'NOT VERIFIED. Inspect the database before trusting these records.') + '</dd></dl>'
        + (g.agents.length ? '<div class=table-wrap><table><caption class=visually-hidden>Registered agents; heartbeats are liveness only, not trust</caption><thead><tr><th scope=col>Agent</th><th scope=col>Role</th><th scope=col>Last heartbeat</th></tr></thead><tbody>' + g.agents.map(a => '<tr><td><code>' + escape(a.agent_id) + '</code></td><td>' + escape(a.role) + '</td><td>' + ago(a.last_heartbeat) + '</td></tr>').join('') + '</tbody></table></div>' : '<p class=hint>No worker or verifier heartbeats recorded yet; they come from separate CLI processes.</p>')
        + '</div></section>';
    }
  }
  const paused = tasks.view.paused;
  const dispatch = '<section class=panel><div class=panel-head><h3>Dispatch</h3><span class=pill>' + (paused ? '<span class="dot dot--warn"></span>Paused' : '<span class="dot dot--ok"></span>Active') + '</span></div><div class=panel-body>'
    + '<p class=hint>Pausing blocks new claims; already-accepted work may still submit and be verified. The choice persists in PostgreSQL.</p>'
    + form(paused ? '/tasks/resume' : '/tasks/pause', csrf, '', paused ? 'Resume dispatch' : 'Pause dispatch', paused ? { variant: 'btn--primary' } : {})
    + '</div></section>';
  const p = tasks.view.policy;
  const policy = '<section class=panel><div class=panel-head><h3>Fixed task policy</h3><span class="badge badge--neutral">' + escape(p.kind) + '</span></div><div class=panel-body>'
    + '<dl class=meta><dt>Kind</dt><dd><code>' + escape(p.kind) + '</code>; a deterministic registry-report worker, not LLM-powered AI</dd>'
    + '<dt>Limits</dt><dd>' + p.maxAttempts + ' attempts · ' + p.leaseSeconds + 's leases · ' + p.maxUnfinished + ' unfinished · ' + p.maxResultBytes + '-byte results</dd>'
    + '<dt>Capability</dt><dd>network ' + p.network + ' · shell ' + p.shell + ' · spend ' + p.spendCents + ' cents · model tokens ' + p.modelTokens + ' · subtasks ' + p.subtasks + ' · trainingEligible ' + p.trainingEligible + '</dd></dl>'
    + '<p class=hint>Objective labels are not executable instructions. Results stay unverified until a separate verifier process accepts them.</p></div></section>';
  const propose = '<section class=panel><div class=panel-head><h3>Propose a task</h3></div><div class=panel-body>'
    + '<form method=post action=/tasks/propose class=stack><input type=hidden name=csrf value="' + escape(csrf) + '"><input type=hidden name=command_key value="' + escape(tasks.proposeKey) + '">'
    + '<label class=field><span class=field-label>Objective label, not instructions</span><input name=objective maxlength=400 required></label>'
    + '<p class=hint>Proposals start as proposed and require owner approval before dispatch. Re-submitting this exact form reuses its command key, so identical retries do not duplicate the task.</p>'
    + '<button class="btn btn--primary">Propose task</button></form></div></section>';
  const counts = new Map<string, number>();
  for (const t of tasks.view.tasks) counts.set(t.state, (counts.get(t.state) ?? 0) + 1);
  const filterBar = [...counts.keys()].map(state => '<button type=button class=filter data-filter=' + escape(state) + ' aria-pressed=false>' + escape(state) + ' <span class=count>' + counts.get(state) + '</span></button>').join('');
  const rows = tasks.view.tasks.map(t => {
    const approve = t.state === 'proposed' ? form('/tasks/approve', csrf, '<input type=hidden name=task value="' + escape(t.id) + '">', 'Approve', { variant: 'btn--primary' }) : '';
    const cancel = ['proposed', 'queued', 'running', 'awaiting_verification'].includes(t.state)
      ? form('/tasks/cancel', csrf, '<input type=hidden name=task value="' + escape(t.id) + '">', 'Cancel', { variant: 'btn--danger', confirm: 'Cancel task ' + short(t.id) + '? Accepted work may still submit.' }) : '';
    const outcome = t.state === 'verified' || t.state === 'rejected'
      ? stateBadge(t.state) + (t.verifier_id ? ' by <code>' + escape(t.verifier_id) + '</code>' : '') + (t.error_code ? ' · <code>' + escape(t.error_code) + '</code>' : '')
      : stateBadge(t.state);
    const result = t.result === null || t.result === undefined ? '' : '<details><summary>Result</summary><div class=panel-body><pre><code>' + escape(String(JSON.stringify(t.result)).slice(0, 1500)) + '</code></pre></div></details>';
    return '<tr data-state=' + escape(t.state) + '><td><code data-copy="' + escape(t.id) + '" title="Copy task id">' + escape(short(t.id)) + '</code></td>'
      + '<td>' + stateBadge(t.state) + '</td><td class=num>' + escape(String(t.attempts)) + '</td>'
      + '<td>' + (t.worker_id ? '<code>' + escape(t.worker_id) + '</code>' : '<span class=muted>-</span>') + '</td>'
      + '<td>' + outcome + '</td><td><div class=cell-main>' + escape(t.objective) + '</div><div class=cell-actions>' + approve + cancel + result + '</div></td></tr>';
  }).join('');
  const tasksTable = tasks.view.tasks.length
    ? '<div class=table-wrap><table><caption class=visually-hidden>Latest 50 tasks for this owner</caption><thead><tr><th scope=col>Task</th><th scope=col>State</th><th scope=col class=num>Attempts</th><th scope=col>Worker</th><th scope=col>Verifier outcome</th><th scope=col>Objective and controls</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
    : '<div class=empty><div class=empty-title>No tasks yet</div><p class=hint>Propose a task above; workers and verifiers are separate local processes.</p></div>';
  const events = tasks.view.events.map(e => '<tr><td class=num>' + escape(String(e.sequence)) + '</td><td><code>' + escape(e.event_type) + '</code></td><td>' + escape(e.actor) + '</td><td>' + (e.task_id ? '<code data-copy="' + escape(e.task_id) + '">' + escape(short(e.task_id)) + '</code>' : '<span class=muted>-</span>') + '</td><td>' + ago(e.created_at) + '</td></tr>').join('');
  const eventsTable = '<section class=panel><div class=panel-head><h3>Durable task events</h3><span class=pill>' + tasks.view.events.length + ' latest</span></div>'
    + '<div class=table-wrap><table><caption class=visually-hidden>Latest 100 durable task events</caption><thead><tr><th scope=col class=num>Seq</th><th scope=col>Event</th><th scope=col>Actor</th><th scope=col>Task</th><th scope=col>Time</th></tr></thead><tbody>' + events + '</tbody></table></div></section>';
  return '<div class=page-head><h2>Owner tasks</h2><p class=hint>Workers and verifiers are separate local processes: node dist/control/owner-task-queue.js worker, verifier or run-once. This dashboard never executes tasks inside the web process, and workers cannot grant themselves capabilities.</p></div>'
    + banner + gov + dispatch + policy + propose
    + '<section class=panel data-refresh=45><div class=panel-head><h3>Tasks</h3><span class=pill>' + tasks.view.tasks.length + ' latest</span></div>'
    + (filterBar ? '<div class=panel-body><div class=filters role=group aria-label="Filter tasks by state">' + filterBar + '</div></div>' : '')
    + tasksTable + '</section>' + eventsTable;
}
export function ownerConsole(data: ReturnType<typeof ownerOverview>, csrf: string, params: { view?: unknown; q?: unknown; error?: unknown }, tasks?: OwnerConsoleTasks) {
  const views = ['overview', 'services', 'blockers', 'runtime', 'tasks'];
  const view = typeof params.view === 'string' && views.includes(params.view) ? params.view : 'overview';
  const query = typeof params.q === 'string' ? params.q.slice(0, 100) : '';
  const error = typeof params.error === 'string' ? params.error.slice(0, 60) : '';
  const matches = (value: string) => value.toLowerCase().includes(query.toLowerCase());
  const nav = views.map(v => '<a href="/?view=' + v + '"' + (v === view ? ' aria-current=page' : '') + '>' + v[0].toUpperCase() + v.slice(1) + '</a>').join('');
  const search = '<form method=get class=search><input type=hidden name=view value="' + view + '"><label class=visually-hidden>Search this view</label><input name=q maxlength=100 value="' + escape(query) + '" placeholder="Search this view"><button class=btn>Filter</button><a class=btn href="/?view=' + view + '">Clear</a></form>';
  const sidebar = '<aside class=sidebar><div class=brand><span class=brand-mark aria-hidden=true>CI</span><span><span class=brand-name>CodexImmortal</span><span class=brand-sub>Owner console</span></span></div>'
    + '<nav class=nav aria-label="Console sections">' + nav + '</nav>'
    + '<div class=sidebar-foot><form method=post action=/logout><input type=hidden name=csrf value="' + escape(csrf) + '"><button class="btn btn--small">Sign out</button></form><span>Local only · no public surface</span></div></aside>';
  const topbar = '<header class=topbar><h1>' + view + '</h1><span class=spacer></span>'
    + '<span class=pill>' + (data.taskDispatch ? '<span class="dot dot--ok"></span>Queue connected' : '<span class="dot dot--muted"></span>No queue') + '</span>'
    + '<span class=pill data-expires="' + escape(data.sessionExpiresAt) + '">' + escape(data.sessionExpiresAt) + '</span></header>';
  const toolbar = '<div class=toolbar><a class=btn href="/?view=' + view + '&' + 'amp;q=' + escape(encodeURIComponent(query)) + '">Refresh snapshot</a>'
    + '<a class="btn btn--primary" href="/api/overview?download=1">Export snapshot JSON</a>'
    + '<a class=btn href=/api/overview>View API response</a><span class=spacer></span>'
    + '<span class=hint>Snapshot generated <time>' + escape(data.observedAt) + '</time></span></div>'
    + '<p class=hint>Local owner console · task controls are on the Tasks view and require the configured local database · live sending, payments and agent self-service are not enabled.</p>';
  let content = '';
  if (view === 'overview') {
    content = '<div class=page-head><h2>Operational overview</h2></div><div class=stat-grid>'
      + '<div class=stat><div class=stat-label>Registry</div><div class=stat-value>' + data.services.length + '</div><div class=stat-sub>standalone service records · <a href="/?view=services">inspect publication status</a></div></div>'
      + '<div class=stat><div class=stat-label>Tracked P0 work</div><div class=stat-value>' + data.blockers.length + '</div><div class=stat-sub>grouped audit findings; not newly detected incidents · <a href="/?view=blockers">acceptance criteria</a></div></div>'
      + '<div class=stat><div class=stat-label>Execution</div><div class=stat-value>' + (data.taskDispatch ? 'Connected' : 'None') + '</div><div class=stat-sub>' + (data.taskDispatch ? 'local task-queue controls are connected; see the Tasks view. Workers stay separate CLI processes.' : 'no task-dispatch or worker-monitoring adapter is connected. Agents cannot be controlled from this build.') + '</div></div>'
      + '<div class=stat><div class=stat-label>Database</div><div class=stat-value>' + (data.taskDispatch ? 'Connected' : 'Not connected') + '</div><div class=stat-sub>local owner task queue only</div></div></div>'
      + '<section class=panel><div class=panel-head><h3>Build and session</h3></div><div class=panel-body><dl class=meta>'
      + '<dt>Configured local revision, not deployed commit</dt><dd><code data-copy="' + escape(data.configuredRevision) + '">' + escape(data.configuredRevision) + '</code></dd>'
      + '<dt>Session expires</dt><dd>' + escape(data.sessionExpiresAt) + '</dd></dl></div></section>';
  }
  if (view === 'services') {
    const rows = data.services.filter(s => matches(s.tool + ' ' + s.status));
    content = '<div class=page-head><h2>Standalone services</h2><p class=hint>Source: <code>' + escape(data.servicesSource) + '</code>. Registry metadata is not a live provider check.</p></div>'
      + search
      + '<section class=panel><div class=table-wrap><table><caption class=visually-hidden>' + rows.length + ' matching records</caption><thead><tr><th scope=col>Tool</th><th scope=col>Status</th><th scope=col>Price</th><th scope=col>Certification</th><th scope=col>Registered</th></tr></thead><tbody>'
      + rows.map(s => '<tr><td><code>' + escape(s.tool) + '</code></td><td><span class="badge badge--neutral">' + escape(s.status) + '</span></td><td>' + (s.price === null ? '<span class=muted>Not approved</span>' : escape(s.price)) + '</td><td>' + escape(s.certification) + '</td><td>' + (s.registered ? 'Yes' : 'No') + '</td></tr>').join('')
      + '</tbody></table></div>'
      + (!rows.length ? '<div class=empty role=status><div class=empty-title>No matching services</div><p class=hint>Clear the filter to see all records.</p></div>' : '')
      + '</section>';
  }
  if (view === 'blockers') {
    const rows = data.blockers.filter(b => matches(b.area + ' ' + b.title + ' ' + b.source + ' ' + b.acceptance));
    content = '<div class=page-head><h2>Product-correctness backlog</h2></div>'
      + '<div class="flash flash--warn">' + escape(data.backlogBasis) + '</div>'
      + search + '<p class=hint role=status>' + rows.length + ' matching findings</p>'
      + rows.map(b => '<details><summary><span class="badge badge--rejected">P0</span> ' + escape(b.area) + ' · ' + escape(b.title) + '</summary><div class=panel-body>'
      + '<dl class=meta><dt>Review source</dt><dd><code>' + escape(b.source) + '</code></dd></dl>'
      + '<h4>Acceptance criteria</h4><p>' + escape(b.acceptance) + '</p>'
      + '<p class=hint>No completion state is inferred or saved by this view.</p></div></details>').join('')
      + (!rows.length ? '<div class=empty><div class=empty-title>No matching blockers</div><p class=hint>Clear the filter.</p></div>' : '');
  }
  if (view === 'runtime') {
    content = '<div class=page-head><h2>Owner process diagnostics</h2><p class=hint>These are current measurements of this owner process, not Render, commerce-worker or database health.</p></div>'
      + '<section class=panel><div class=panel-body><dl class=meta>'
      + Object.entries(data.runtime).map(([key, value]) => '<dt>' + escape(key) + '</dt><dd><code>' + escape(key === 'rssBytes' ? humanBytes(value) : key === 'uptimeSeconds' ? humanUptime(Number(value)) : value) + '</code></dd>').join('')
      + '</dl></div></section>'
      + '<p class=hint>Runtime values describe this owner process only; database and workers fields reflect local task-queue configuration, and heartbeat data is liveness only, not supervision. Missing telemetry is not a zero count or a healthy status.</p>';
  }
  if (view === 'tasks') content = tasksPanel(csrf, tasks, error);
  return document('Owner control',
    '<div class=shell>' + sidebar + '<div class=main>' + topbar
    + '<main class=content>' + toolbar + content
    + '<footer class=note-foot><span>No customer documents, payment payloads or credentials are included in snapshot exports.</span></footer>'
    + '</main></div></div>');
}
