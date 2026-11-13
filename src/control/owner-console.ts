import { proposedServices } from '../agent-services/registry.js';
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
export function ownerOverview(owner: string, revision: string, time: number, expires: number) {
  return { owner, configuredRevision: revision, observedAt: new Date(time).toISOString(),
    sessionExpiresAt: new Date(expires).toISOString(), serviceReadiness: 'not_evaluated',
    taskDispatch: false, liveSending: false, paymentAdministration: false,
    services: proposedServices, servicesSource: 'src/agent-services/registry.ts',
    blockers, backlogBasis: 'Tracked handoff audit findings; not a fresh scan or verified remediation status.',
    runtime: { scope: 'owner process only', node: process.version, uptimeSeconds: Math.floor(process.uptime()),
      rssBytes: process.memoryUsage().rss, database: 'not_connected', workers: 'not_connected' } };
}
export const ownerCss = `:root{color-scheme:dark;font-family:system-ui,sans-serif;background:#0c1422;color:#e6edf7}*{box-sizing:border-box}body{margin:0}header,main{max-width:1180px;margin:auto;padding:24px}header{border-bottom:1px solid #34445b}h1{margin:8px 0}p{line-height:1.6}.muted,small{color:#b3c1d5}nav,.toolbar{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin:20px 0}a{color:#8dc7ff}nav a,button,.button{padding:12px 16px;border:1px solid #526680;border-radius:6px;background:#18273b;color:#eef5ff;text-decoration:none;font:inherit;cursor:pointer}nav a[aria-current=page]{border-color:#8dc7ff;background:#233d59}a:focus-visible,button:focus-visible,input:focus-visible,summary:focus-visible{outline:3px solid #7fe0c3;outline-offset:3px}input{padding:12px;background:#101d30;color:#fff;border:1px solid #8194ae;border-radius:4px;font:inherit;max-width:100%}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}.panel,details{padding:20px;border:1px solid #34465f;border-radius:8px;background:#132035;margin-bottom:16px}.notice{border-left:4px solid #eab96b;padding:12px 16px;background:#252433}.scroll{overflow:auto}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:14px;border-bottom:1px solid #34465f;vertical-align:top}caption{text-align:left;padding:12px 0}code{font-family:ui-monospace,monospace;overflow-wrap:anywhere}dt{color:#b3c1d5;margin-top:14px}dd{margin:5px 0;overflow-wrap:anywhere}summary{cursor:pointer;padding:8px;line-height:1.5}.login{max-width:520px}label{display:block;margin:12px 0}.login input{display:block;width:100%;margin-top:8px}.error{color:#ffd39c}footer{padding:18px 0;border-top:1px solid #34465f}button{min-height:44px}@media(max-width:600px){header,main{padding:16px}nav a{flex:1;text-align:center}th,td{padding:10px}}`;
const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
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
export function ownerConsole(data: ReturnType<typeof ownerOverview>, csrf: string, params: { view?: unknown; q?: unknown }) {
  const views = ['overview', 'services', 'blockers', 'runtime'];
  const view = typeof params.view === 'string' && views.includes(params.view) ? params.view : 'overview';
  const query = typeof params.q === 'string' ? params.q.slice(0,100) : '';
  const matches = (value: string) => value.toLowerCase().includes(query.toLowerCase());
  const nav = views.map(v => '<a href="/?view=' + v + '"' + (v === view ? ' aria-current=page' : '') + '>' + v[0].toUpperCase() + v.slice(1) + '</a>').join('');
  const search = '<form method=get class=toolbar><input type=hidden name=view value="' + view + '"><label>Search this view <input name=q maxlength=100 value="' + escape(query) + '"></label><button>Filter</button><a href="/?view=' + view + '">Clear</a></form>';
  let content = '';
  if (view === 'overview') content = '<h2>Operational overview</h2><div class=grid><section class=panel><h3>Registry</h3><p>' + data.services.length + ' standalone service records</p><a href="/?view=services">Inspect publication status</a></section><section class=panel><h3>Tracked P0 work</h3><p>' + data.blockers.length + ' grouped audit findings; not newly detected incidents.</p><a href="/?view=blockers">Inspect acceptance criteria</a></section><section class=panel><h3>Execution</h3><p>No task-dispatch or worker-monitoring adapter is connected. Agents cannot be controlled from this build.</p></section></div><section class=panel><h3>Build and session</h3><dl><dt>Configured local revision, not deployed commit</dt><dd><code>' + escape(data.configuredRevision) + '</code></dd><dt>Session expires</dt><dd>' + escape(data.sessionExpiresAt) + '</dd></dl></section>';
  if (view === 'services') {
    const rows = data.services.filter(s => matches(s.tool + ' ' + s.status));
    content = '<h2>Standalone services</h2><p>Source: <code>' + escape(data.servicesSource) + '</code>. Registry metadata is not a live provider check.</p>' + search + '<div class=scroll><table><caption>' + rows.length + ' matching records</caption><thead><tr><th scope=col>Tool</th><th scope=col>Status</th><th scope=col>Price</th><th scope=col>Certification</th><th scope=col>Registered</th></tr></thead><tbody>' + rows.map(s => '<tr><td><code>' + escape(s.tool) + '</code></td><td>' + escape(s.status) + '</td><td>' + (s.price === null ? 'Not approved' : escape(s.price)) + '</td><td>' + escape(s.certification) + '</td><td>' + (s.registered ? 'Yes' : 'No') + '</td></tr>').join('') + '</tbody></table></div>' + (!rows.length ? '<p role=status>No matching services. Clear the filter to see all records.</p>' : '');
  }
  if (view === 'blockers') {
    const rows = data.blockers.filter(b => matches(b.area + ' ' + b.title + ' ' + b.source + ' ' + b.acceptance));
    content = '<h2>Product-correctness backlog</h2><p class=notice>' + escape(data.backlogBasis) + '</p>' + search + '<p role=status>' + rows.length + ' matching findings</p>' + rows.map(b => '<details><summary>P0 / ' + escape(b.area) + ' / ' + escape(b.title) + '</summary><p>Review source: <code>' + escape(b.source) + '</code></p><h3>Acceptance criteria</h3><p>' + escape(b.acceptance) + '</p><p class=muted>No completion state is inferred or saved by this view.</p></details>').join('') + (!rows.length ? '<p>No matching blockers. Clear the filter.</p>' : '');
  }
  if (view === 'runtime') content = '<h2>Owner process diagnostics</h2><p>These are current measurements of this owner process, not Render, commerce-worker or database health.</p><section class=panel><dl>' + Object.entries(data.runtime).map(([key,value]) => '<dt>' + escape(key) + '</dt><dd><code>' + escape(value) + '</code></dd>').join('') + '</dl></section><p>There is no connected database/worker telemetry adapter. Missing telemetry is not a zero count or a healthy status.</p>';
  return document('Owner control', '<header><p class=muted>CODEXIMMORTAL / LOCAL OWNER CONSOLE</p><h1>Owner control</h1><p>Signed in as ' + escape(data.owner) + '</p><nav aria-label="Console sections">' + nav + '</nav></header><main><p class=notice>Read-only console. Service execution, funding, live sending and agent controls are not enabled.</p><div class=toolbar><a class=button href="/?view=' + view + '&amp;q=' + escape(encodeURIComponent(query)) + '">Refresh snapshot</a><a class=button href="/api/overview?download=1">Export snapshot JSON</a><a href=/api/overview>View API response</a></div><p class=muted>Snapshot generated: <time>' + escape(data.observedAt) + '</time></p>' + content + '<footer><form method=post action=/logout><input type=hidden name=csrf value="' + escape(csrf) + '"><button>Sign out</button></form><p class=muted>No customer documents, payment payloads or credentials are included in snapshot exports.</p></footer></main>');
}
