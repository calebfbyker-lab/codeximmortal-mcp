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
export const ownerCss = `:root{color-scheme:dark;font-family:system-ui,sans-serif;background:#0c1422;color:#e6edf7}*{box-sizing:border-box}body{margin:0}header,main{max-width:1180px;margin:auto;padding:24px}header{border-bottom:1px solid #34445b}h1{margin:8px 0}p{line-height:1.6}.muted,small{color:#b3c1d5}nav,.toolbar{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin:20px 0}a{color:#8dc7ff}nav a,button,.button{padding:12px 16px;border:1px solid #526680;border-radius:6px;background:#18273b;color:#eef5ff;text-decoration:none;font:inherit;cursor:pointer}nav a[aria-current=page]{border-color:#8dc7ff;background:#233d59}a:focus-visible,button:focus-visible,input:focus-visible,summary:focus-visible{outline:3px solid #7fe0c3;outline-offset:3px}input{padding:12px;background:#101d30;color:#fff;border:1px solid #8194ae;border-radius:4px;font:inherit;max-width:100%}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}.panel,details{padding:20px;border:1px solid #34465f;border-radius:8px;background:#132035;margin-bottom:16px}.notice{border-left:4px solid #eab96b;padding:12px 16px;background:#252433}.scroll{overflow:auto}td form{display:inline-block;margin:2px 4px 2px 0}pre{overflow:auto}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:14px;border-bottom:1px solid #34465f;vertical-align:top}caption{text-align:left;padding:12px 0}code{font-family:ui-monospace,monospace;overflow-wrap:anywhere}dt{color:#b3c1d5;margin-top:14px}dd{margin:5px 0;overflow-wrap:anywhere}summary{cursor:pointer;padding:8px;line-height:1.5}.login{max-width:520px}label{display:block;margin:12px 0}.login input{display:block;width:100%;margin-top:8px}.error{color:#ffd39c}footer{padding:18px 0;border-top:1px solid #34465f}button{min-height:44px}@media(max-width:600px){header,main{padding:16px}nav a{flex:1;text-align:center}th,td{padding:10px}}`;
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
  return '<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>' + escape(title) + '</title><link rel=stylesheet href=/assets/owner.css></head><body>' + content + '</body></html>';
}
export function ownerLogin(error = '') {
  const messages: Record<string, string> = { unauthorized: 'Sign-in failed. Check your owner name and password.',
    origin_denied: 'Reload the login page using the exact configured HTTPS address before signing in.',
    login_limited: 'Too many sign-in attempts. Wait one minute and retry.' };
  return document('Owner login', '<main class=login><h1>Owner login</h1><p class=muted>Local CodexImmortal control console. No public registration.</p>' +
    (error ? '<p class=error role=alert>' + escape(messages[error] ?? 'Sign-in failed.') + '</p>' : '') +
    '<form method=post action=/login><label>Owner<input name=owner autocomplete=username required maxlength=100></label>' +
    '<label>Password<input name=password type=password autocomplete=current-password required maxlength=256></label><button>Sign in</button></form></main>');
}
const when = (value: unknown) => value instanceof Date ? value.toISOString() : String(value ?? '');
const short = (value: string) => value.slice(0, 8);
function form(action: string, csrf: string, fields: string, label: string) {
  return '<form method=post action=' + action + '><input type=hidden name=csrf value="' + escape(csrf) + '">' + fields + '<button>' + label + '</button></form>';
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
    return '<h2>Owner tasks</h2><p class=notice>' + reason + '</p><section class=panel><p>Configure locally, never in chat: <code>CODEX_OWNER_TASK_DATABASE_URL</code> for a dedicated loopback PostgreSQL database named <code>codex_owner_control</code>, plus <code>CODEX_OWNER_TASK_DB_ACK=local-owner-tasks-only</code>, then run <code>node dist/control/owner-task-queue.js init</code>.</p></section>';
  }
  const banner = error ? '<p class=error role=alert>' + escape(taskMessages[error] ?? 'The task action failed.') + '</p>' : '';
  let gov = '';
  if (tasks.governance) {
    if ('unavailable' in tasks.governance) {
      gov = '<section class=panel><h3>Governance</h3><p class=notice>Governance state is unavailable, so task proposals fail closed. If the governance tables are missing, run <code>node dist/control/owner-task-queue.js init-governance</code> for the configured database.</p></section>';
    } else {
      const g = tasks.governance;
      gov = '<section class=panel><h3>Governance</h3><dl><dt>Active dispatch policy</dt><dd>version ' + escape(String(g.policy.version)) + ', sha256 <code>' + escape(g.policy.documentSha256.slice(0, 16)) + '</code></dd><dt>Audit chain</dt><dd>' + (g.chainVerified ? 'Verified across the latest 100 governance events.' : 'NOT VERIFIED. Inspect the database before trusting these records.') + '</dd></dl>' + (g.agents.length ? '<div class=scroll><table><caption>Registered agents; heartbeats are liveness only, not trust</caption><thead><tr><th scope=col>Agent</th><th scope=col>Role</th><th scope=col>Last heartbeat</th></tr></thead><tbody>' + g.agents.map(a => '<tr><td><code>' + escape(a.agent_id) + '</code></td><td>' + escape(a.role) + '</td><td>' + escape(when(a.last_heartbeat)) + '</td></tr>').join('') + '</tbody></table></div>' : '<p class=muted>No worker or verifier heartbeats recorded yet; they come from separate CLI processes.</p>') + '</section>';
    }
  }
  const paused = tasks.view.paused;
  const dispatch = '<section class=panel><h3>Dispatch</h3><p>Dispatch is <strong>' + (paused ? 'paused' : 'active') + '</strong>. Pausing blocks new claims; already-accepted work may still submit and be verified. The choice persists in PostgreSQL.</p>' + form(paused ? '/tasks/resume' : '/tasks/pause', csrf, '', paused ? 'Resume dispatch' : 'Pause dispatch') + '</section>';
  const p = tasks.view.policy;
  const policy = '<section class=panel><h3>Fixed task policy</h3><dl><dt>Kind</dt><dd><code>' + escape(p.kind) + '</code>; a deterministic registry-report worker, not LLM-powered AI</dd><dt>Limits</dt><dd>' + p.maxAttempts + ' attempts / ' + p.leaseSeconds + 's leases / ' + p.maxUnfinished + ' unfinished / ' + p.maxResultBytes + '-byte results</dd><dt>Capability</dt><dd>network ' + p.network + ', shell ' + p.shell + ', spend ' + p.spendCents + ' cents, model tokens ' + p.modelTokens + ', subtasks ' + p.subtasks + ', trainingEligible ' + p.trainingEligible + '</dd></dl><p class=muted>Objective labels are not executable instructions. Results stay unverified until a separate verifier process accepts them.</p></section>';
  const propose = '<section class=panel><h3>Propose a task</h3><form method=post action=/tasks/propose><input type=hidden name=csrf value="' + escape(csrf) + '"><input type=hidden name=command_key value="' + escape(tasks.proposeKey) + '"><label>Objective label, not instructions<input name=objective maxlength=400 required></label><button>Propose task</button></form><p class=muted>Proposals start as proposed and require owner approval before dispatch. Re-submitting this exact form reuses its command key, so identical retries do not duplicate the task.</p></section>';
  const rows = tasks.view.tasks.map(t => {
    const approve = t.state === 'proposed' ? form('/tasks/approve', csrf, '<input type=hidden name=task value="' + escape(t.id) + '">', 'Approve') : '';
    const cancel = ['proposed', 'queued', 'running', 'awaiting_verification'].includes(t.state) ? form('/tasks/cancel', csrf, '<input type=hidden name=task value="' + escape(t.id) + '">', 'Cancel') : '';
    const outcome = t.state === 'verified' || t.state === 'rejected'
      ? escape(t.state) + (t.verifier_id ? ' by <code>' + escape(t.verifier_id) + '</code>' : '') + (t.error_code ? ', <code>' + escape(t.error_code) + '</code>' : '')
      : 'pending';
    const result = t.result === null || t.result === undefined ? '' : '<details><summary>Result</summary><pre><code>' + escape(String(JSON.stringify(t.result)).slice(0, 1500)) + '</code></pre></details>';
    return '<tr><td><code>' + escape(short(t.id)) + '</code></td><td>' + escape(t.state) + '</td><td>' + escape(String(t.attempts)) + '</td><td>' + (t.worker_id ? '<code>' + escape(t.worker_id) + '</code>' : '-') + '</td><td>' + outcome + '</td><td>' + escape(t.objective) + approve + cancel + result + '</td></tr>';
  }).join('');
  const tasksTable = '<div class=scroll><table><caption>Latest 50 tasks for this owner</caption><thead><tr><th scope=col>Task</th><th scope=col>State</th><th scope=col>Attempts</th><th scope=col>Worker</th><th scope=col>Verifier outcome</th><th scope=col>Objective and controls</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  const events = tasks.view.events.map(e => '<tr><td>' + escape(String(e.sequence)) + '</td><td><code>' + escape(e.event_type) + '</code></td><td>' + escape(e.actor) + '</td><td>' + (e.task_id ? '<code>' + escape(short(e.task_id)) + '</code>' : '-') + '</td><td>' + escape(when(e.created_at)) + '</td></tr>').join('');
  const eventsTable = '<div class=scroll><table><caption>Latest 100 durable task events</caption><thead><tr><th scope=col>Seq</th><th scope=col>Event</th><th scope=col>Actor</th><th scope=col>Task</th><th scope=col>Time</th></tr></thead><tbody>' + events + '</tbody></table></div>';
  return '<h2>Owner tasks</h2>' + banner + gov + dispatch + policy + propose + tasksTable + eventsTable + '<p class=muted>Workers and verifiers are separate local processes: node dist/control/owner-task-queue.js worker, verifier or run-once. This dashboard never executes tasks inside the web process, and workers cannot grant themselves capabilities.</p>';
}
export function ownerConsole(data: ReturnType<typeof ownerOverview>, csrf: string, params: { view?: unknown; q?: unknown; error?: unknown }, tasks?: OwnerConsoleTasks) {
  const views = ['overview', 'services', 'blockers', 'runtime', 'tasks'];
  const view = typeof params.view === 'string' && views.includes(params.view) ? params.view : 'overview';
  const query = typeof params.q === 'string' ? params.q.slice(0, 100) : '';
  const error = typeof params.error === 'string' ? params.error.slice(0, 60) : '';
  const matches = (value: string) => value.toLowerCase().includes(query.toLowerCase());
  const nav = views.map(v => '<a href="/?view=' + v + '"' + (v === view ? ' aria-current=page' : '') + '>' + v[0].toUpperCase() + v.slice(1) + '</a>').join('');
  const search = '<form method=get class=toolbar><input type=hidden name=view value="' + view + '"><label>Search this view <input name=q maxlength=100 value="' + escape(query) + '"></label><button>Filter</button><a href="/?view=' + view + '">Clear</a></form>';
  let content = '';
  if (view === 'overview') content = '<h2>Operational overview</h2><div class=grid><section class=panel><h3>Registry</h3><p>' + data.services.length + ' standalone service records</p><a href="/?view=services">Inspect publication status</a></section><section class=panel><h3>Tracked P0 work</h3><p>' + data.blockers.length + ' grouped audit findings; not newly detected incidents.</p><a href="/?view=blockers">Inspect acceptance criteria</a></section><section class=panel><h3>Execution</h3><p>' + (data.taskDispatch ? 'Local task-queue controls are connected; see the Tasks view. Workers stay separate CLI processes.' : 'No task-dispatch or worker-monitoring adapter is connected. Agents cannot be controlled from this build.') + '</p></section></div><section class=panel><h3>Build and session</h3><dl><dt>Configured local revision, not deployed commit</dt><dd><code>' + escape(data.configuredRevision) + '</code></dd><dt>Session expires</dt><dd>' + escape(data.sessionExpiresAt) + '</dd></dl></section>';
  if (view === 'services') {
    const rows = data.services.filter(s => matches(s.tool + ' ' + s.status));
    content = '<h2>Standalone services</h2><p>Source: <code>' + escape(data.servicesSource) + '</code>. Registry metadata is not a live provider check.</p>' + search + '<div class=scroll><table><caption>' + rows.length + ' matching records</caption><thead><tr><th scope=col>Tool</th><th scope=col>Status</th><th scope=col>Price</th><th scope=col>Certification</th><th scope=col>Registered</th></tr></thead><tbody>' + rows.map(s => '<tr><td><code>' + escape(s.tool) + '</code></td><td>' + escape(s.status) + '</td><td>' + (s.price === null ? 'Not approved' : escape(s.price)) + '</td><td>' + escape(s.certification) + '</td><td>' + (s.registered ? 'Yes' : 'No') + '</td></tr>').join('') + '</tbody></table></div>' + (!rows.length ? '<p role=status>No matching services. Clear the filter to see all records.</p>' : '');
  }
  if (view === 'blockers') {
    const rows = data.blockers.filter(b => matches(b.area + ' ' + b.title + ' ' + b.source + ' ' + b.acceptance));
    content = '<h2>Product-correctness backlog</h2><p class=notice>' + escape(data.backlogBasis) + '</p>' + search + '<p role=status>' + rows.length + ' matching findings</p>' + rows.map(b => '<details><summary>P0 / ' + escape(b.area) + ' / ' + escape(b.title) + '</summary><p>Review source: <code>' + escape(b.source) + '</code></p><h3>Acceptance criteria</h3><p>' + escape(b.acceptance) + '</p><p class=muted>No completion state is inferred or saved by this view.</p></details>').join('') + (!rows.length ? '<p>No matching blockers. Clear the filter.</p>' : '');
  }
  if (view === 'runtime') content = '<h2>Owner process diagnostics</h2><p>These are current measurements of this owner process, not Render, commerce-worker or database health.</p><section class=panel><dl>' + Object.entries(data.runtime).map(([key, value]) => '<dt>' + escape(key) + '</dt><dd><code>' + escape(value) + '</code></dd>').join('') + '</dl></section><p>Runtime values describe this owner process only; database and workers fields reflect local task-queue configuration, and heartbeat data is liveness only, not supervision. Missing telemetry is not a zero count or a healthy status.</p>';
  if (view === 'tasks') content = tasksPanel(csrf, tasks, error);
  return document('Owner control', '<header><p class=muted>CODEXIMMORTAL / LOCAL OWNER CONSOLE</p><h1>Owner control</h1><p>Signed in as ' + escape(data.owner) + '</p><nav aria-label="Console sections">' + nav + '</nav></header><main><p class=notice>Local owner console. Task controls are on the Tasks view and require the configured local database. Live sending, payments and agent self-service are not enabled.</p><div class=toolbar><a class=button href="/?view=' + view + '&' + 'amp;q=' + escape(encodeURIComponent(query)) + '">Refresh snapshot</a><a class=button href="/api/overview?download=1">Export snapshot JSON</a><a href=/api/overview>View API response</a></div><p class=muted>Snapshot generated: <time>' + escape(data.observedAt) + '</time></p>' + content + '<footer><form method=post action=/logout><input type=hidden name=csrf value="' + escape(csrf) + '"><button>Sign out</button></form><p class=muted>No customer documents, payment payloads or credentials are included in snapshot exports.</p></footer></main>');
}
