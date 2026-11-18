import { afterEach, describe, expect, it } from 'vitest';
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { scryptSync } from 'node:crypto';
import { createOwnerControlApp, type OwnerGovernanceStore, type OwnerTaskStore } from './owner-app.js';
import { ownerConsole, ownerOverview } from './owner-console.js';
import { OWNER_TASK_POLICY, localOwnerTaskPool, type OwnerTaskView } from './owner-task-queue.js';
import { defaultDispatchPolicyDocument, policyFloorViolation } from './owner-governance.js';

describe('governance policy floor', () => {
  it('accepts the default dispatch policy and keeps it aligned with the fixed queue policy', () => {
    const document = defaultDispatchPolicyDocument();
    expect(policyFloorViolation(document)).toBeNull();
    expect(document).toEqual({ maxAttempts: OWNER_TASK_POLICY.maxAttempts, leaseSeconds: OWNER_TASK_POLICY.leaseSeconds,
      maxUnfinished: OWNER_TASK_POLICY.maxUnfinished, maxResultBytes: OWNER_TASK_POLICY.maxResultBytes,
      network: OWNER_TASK_POLICY.network, shell: OWNER_TASK_POLICY.shell, spendCents: OWNER_TASK_POLICY.spendCents,
      modelTokens: OWNER_TASK_POLICY.modelTokens, subtasks: OWNER_TASK_POLICY.subtasks, trainingEligible: OWNER_TASK_POLICY.trainingEligible });
  });
  it('rejects loosening documents', () => {
    expect(policyFloorViolation({ ...defaultDispatchPolicyDocument(), maxAttempts: 4 })).toBe('maxAttempts');
    expect(policyFloorViolation({ ...defaultDispatchPolicyDocument(), leaseSeconds: 31 })).toBe('leaseSeconds');
    expect(policyFloorViolation({ ...defaultDispatchPolicyDocument(), network: true })).toBe('network');
    expect(policyFloorViolation({ ...defaultDispatchPolicyDocument(), spendCents: 1 })).toBe('spendCents');
    expect(policyFloorViolation({ ...defaultDispatchPolicyDocument(), subtasks: 1 })).toBe('subtasks');
  });
});

describe('local task database configuration', () => {
  it('returns no pool when unconfigured and rejects unsafe configuration', async () => {
    expect(localOwnerTaskPool({})).toBeUndefined();
    expect(() => localOwnerTaskPool({ CODEX_OWNER_TASK_DATABASE_URL: 'postgres://u:p@localhost:5432/codex_owner_control' })).toThrow('local_task_database_configuration_required');
    expect(() => localOwnerTaskPool({ CODEX_OWNER_TASK_DATABASE_URL: 'postgres://u:p@example.test:5432/codex_owner_control', CODEX_OWNER_TASK_DB_ACK: 'local-owner-tasks-only' })).toThrow('dedicated_local_task_database_required');
    expect(() => localOwnerTaskPool({ CODEX_OWNER_TASK_DATABASE_URL: 'postgres://u:p@localhost:5432/other_db', CODEX_OWNER_TASK_DB_ACK: 'local-owner-tasks-only' })).toThrow('dedicated_local_task_database_required');
    const pool = localOwnerTaskPool({ CODEX_OWNER_TASK_DATABASE_URL: 'postgres://u:p@localhost:5432/codex_owner_control', CODEX_OWNER_TASK_DB_ACK: 'local-owner-tasks-only' });
    expect(pool).toBeTruthy();
    if (pool) await pool.end();
  });
});

describe('tasks view rendering', () => {
  const data = () => ownerOverview('owner', '89515a3b706edbafb240e86b5bad4ad03c4bbcbd', 1000, 901000, true);
  const view: OwnerTaskView = { paused: true, policy: OWNER_TASK_POLICY, tasks: [], events: [] };
  it('shows the not-configured state rather than fabricated activity', () => {
    const html = ownerConsole(data(), 'csrf', { view: 'tasks' });
    expect(html).toContain('missing-configuration state');
    expect(html).not.toContain('action=/tasks/propose');
  });
  it('renders controls, fixed policy and governance state from actual data', () => {
    const html = ownerConsole(data(), 'test-csrf', { view: 'tasks' }, { configured: true, view, proposeKey: '11111111-1111-4111-8111-111111111111',
      governance: { policy: { version: 1, document: {}, documentSha256: 'a'.repeat(64) }, chainVerified: true,
        agents: [{ agent_id: 'registry-observer', role: 'worker', last_heartbeat: new Date(0), last_task_id: null }] } });
    expect(html).toContain('action=/tasks/propose');
    expect(html).toContain('name=command_key value="11111111-1111-4111-8111-111111111111"');
    expect(html).toContain('Resume dispatch');
    expect(html).toContain('not LLM-powered AI');
    expect(html).toContain('registry-observer');
    expect(html).toContain('Verified across the latest 100');
  });
  it('escapes task content and objective labels', () => {
    const hostile: OwnerTaskView = { paused: false, policy: OWNER_TASK_POLICY, events: [],
      tasks: [{ id: '22222222-3333-4222-8222-222222222222', command_key: '22222222-3333-4222-8222-222222222222',
        objective: '<script>bad()</script>', baseline_revision: 'a'.repeat(40), state: 'proposed', attempts: 0,
        worker_id: null, verifier_id: null, error_code: null, result: null, created_at: new Date(0) }] };
    const html = ownerConsole(data(), 'csrf', { view: 'tasks' }, { configured: true, view: hostile, proposeKey: '11111111-1111-4111-8111-111111111111' });
    expect(html).not.toContain('<script>bad()</script>');
    expect(html).toContain('&' + 'lt;script&' + 'gt;');
  });
});

// Stub stores only; no database is touched by these HTTP boundary tests.
class StubTasks implements OwnerTaskStore {
  proposed: unknown[][] = []; approved: string[] = []; cancelled: string[] = []; pauses: boolean[] = []; failPropose = false;
  async propose(key: string, objective: string, baseline: string) {
    if (this.failPropose) throw new Error('private-marker');
    this.proposed.push([key, objective, baseline]);
    return { id: key, owner_id: 'owner', objective, baseline_revision: baseline, state: 'proposed', attempts: 0, lease_token: null, worker_id: null, result: null };
  }
  async approve(id: string) { this.approved.push(id); }
  async cancel(id: string) { this.cancelled.push(id); }
  async pause(paused: boolean) { this.pauses.push(paused); }
  async view(): Promise<OwnerTaskView> { return { paused: false, policy: OWNER_TASK_POLICY, tasks: [], events: [] }; }
}
class StubGovernance implements OwnerGovernanceStore {
  events: string[] = []; denyPolicy = false;
  async activePolicy() { if (this.denyPolicy) throw new Error('policy_unavailable_or_tampered'); return { version: 1, document: {}, documentSha256: 'a'.repeat(64) }; }
  async recordApproval(taskId: string, _policyKind: string, _policyVersion: number, action: string, decision: 'approved' | 'denied') { this.events.push('approval:' + taskId + ':' + action + ':' + decision); }
  async audit(eventType: string, _actor: string, _payload?: Record<string, unknown>) { this.events.push(eventType); }
  async verifyChain() { return true; }
  async listAgents() { return []; }
}
const password = 'synthetic-owner-password-only';
const origin = 'https://owner.example.test';
const saltHex = '12'.repeat(16);
const revision = '89515a3b706edbafb240e86b5bad4ad03c4bbcbd';
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.closeAllConnections(); server.close(error => error ? reject(error) : resolve());
  })));
});
function build(tasks?: OwnerTaskStore, governance?: OwnerGovernanceStore) {
  return createOwnerControlApp({ origin, owner: 'owner', saltHex,
    hashHex: scryptSync(password, Buffer.from(saltHex, 'hex'), 64).toString('hex'), revision }, Date.now, tasks, governance);
}
async function start(tasks?: OwnerTaskStore, governance?: OwnerGovernanceStore) {
  const server = build(tasks, governance).listen(0, '127.0.0.1'); servers.push(server);
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
function send(base: string, path: string, body?: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; text: string; cookie: string; location: string }>((resolve, reject) => {
    const req = request(new URL(path, base), { agent: false, method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body === undefined ? {} : { 'Content-Length': Buffer.byteLength(body) }), ...headers } }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', chunk => { text += chunk; });
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text,
        cookie: res.headers['set-cookie']?.[0] ?? '', location: String(res.headers.location ?? '') }));
    });
    req.setTimeout(5000, () => req.destroy(new Error('fixture_timeout')));
    req.on('error', reject); req.end(body);
  });
}
async function login(base: string) {
  const credentials = new URLSearchParams({ owner: 'owner', password }).toString();
  const result = await send(base, '/login', credentials, { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' });
  if (result.status !== 303) throw new Error('fixture_login_failed');
  const cookie = result.cookie.split(';')[0];
  const page = await send(base, '/', undefined, { Cookie: cookie });
  const csrf = /name=csrf value="([^"]+)"/.exec(page.text)?.[1];
  if (!csrf) throw new Error('fixture_csrf_missing');
  return { cookie, csrf };
}
const formHeaders = (cookie: string) => ({ Cookie: cookie, Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' });

describe('owner task HTTP boundary (stub stores, synthetic credentials)', () => {
  it('reports the not-configured state and fails closed for mutations', async () => {
    const base = await start();
    const { cookie, csrf } = await login(base);
    const api = await send(base, '/api/tasks', undefined, { Cookie: cookie });
    expect(api.status).toBe(200); expect(JSON.parse(api.text)).toEqual({ configured: false });
    const proposal = new URLSearchParams({ csrf, command_key: '11111111-1111-4111-8111-111111111111', objective: 'Inspect the registry' }).toString();
    const form = await send(base, '/tasks/propose', proposal, formHeaders(cookie));
    expect(form.status).toBe(303); expect(form.location).toContain('error=owner_task_database_not_configured');
    const json = await send(base, '/tasks/propose', JSON.stringify({ csrf, command_key: '11111111-1111-4111-8111-111111111111', objective: 'Inspect the registry' }),
      { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' });
    expect(json.status).toBe(503);
  });
  it('enforces origin, session and CSRF on every task mutation', async () => {
    const tasks = new StubTasks(); const base = await start(tasks);
    const { cookie, csrf } = await login(base);
    const body = new URLSearchParams({ csrf, command_key: '11111111-1111-4111-8111-111111111111', objective: 'Inspect the registry' }).toString();
    expect((await send(base, '/tasks/propose', body, { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' })).status).toBe(403);
    expect((await send(base, '/tasks/propose', body, { Origin: 'https://foreign.example.test', Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' })).status).toBe(403);
    expect((await send(base, '/tasks/propose', body, { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' })).status).toBe(401);
    const wrongCsrf = new URLSearchParams({ csrf: 'wrong', command_key: '11111111-1111-4111-8111-111111111111', objective: 'Inspect the registry' }).toString();
    expect((await send(base, '/tasks/propose', wrongCsrf, formHeaders(cookie))).status).toBe(403);
    expect((await send(base, '/tasks/approve', new URLSearchParams({ csrf, task: '22222222-3333-4222-8222-222222222222' }).toString(), formHeaders(cookie))).status).toBe(303);
    expect(tasks.proposed).toHaveLength(0);
    expect(tasks.approved).toEqual(['22222222-3333-4222-8222-222222222222']);
  });
  it('accepts valid proposals, approvals, cancellations and pause/resume', async () => {
    const tasks = new StubTasks(); const governance = new StubGovernance();
    const base = await start(tasks, governance);
    const { cookie, csrf } = await login(base);
    const headers = formHeaders(cookie);
    const key = '11111111-1111-4111-8111-111111111111';
    const proposal = new URLSearchParams({ csrf, command_key: key, objective: 'Inspect the committed service registry' }).toString();
    const result = await send(base, '/tasks/propose', proposal, headers);
    expect(result.status).toBe(303); expect(result.location).toBe('/?view=tasks');
    expect(tasks.proposed).toEqual([[key, 'Inspect the committed service registry', revision]]);
    expect(governance.events).toEqual(['task_proposed']);
    expect((await send(base, '/tasks/approve', new URLSearchParams({ csrf, task: key }).toString(), headers)).status).toBe(303);
    expect(governance.events).toContain('approval:' + key + ':task_approve:approved');
    expect(governance.events).toContain('task_approved');
    expect((await send(base, '/tasks/cancel', new URLSearchParams({ csrf, task: key }).toString(), headers)).status).toBe(303);
    expect((await send(base, '/tasks/pause', new URLSearchParams({ csrf }).toString(), headers)).status).toBe(303);
    expect((await send(base, '/tasks/resume', new URLSearchParams({ csrf }).toString(), headers)).status).toBe(303);
    expect(tasks.pauses).toEqual([true, false]);
    expect(tasks.cancelled).toEqual([key]);
  });
  it('serves authenticated task state and accepts JSON commands', async () => {
    const tasks = new StubTasks(); const base = await start(tasks);
    const { cookie, csrf } = await login(base);
    const api = await send(base, '/api/tasks', undefined, { Cookie: cookie });
    expect(api.status).toBe(200); expect(JSON.parse(api.text).configured).toBe(true);
    expect((await send(base, '/api/tasks')).status).toBe(401);
    const json = await send(base, '/tasks/propose', JSON.stringify({ csrf, command_key: '33333333-3333-4333-8333-333333333333', objective: 'Label only' }),
      { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' });
    expect(json.status).toBe(200); expect(JSON.parse(json.text)).toEqual({ accepted: true });
    expect((await send(base, '/tasks/propose', JSON.stringify({ csrf, command_key: 'not-a-uuid', objective: 'Label only' }),
      { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' })).status).toBe(400);
  });
  it('fails proposals closed when the dispatch policy cannot be verified', async () => {
    const tasks = new StubTasks(); const governance = new StubGovernance(); governance.denyPolicy = true;
    const base = await start(tasks, governance);
    const { cookie, csrf } = await login(base);
    const headers = formHeaders(cookie);
    const proposal = new URLSearchParams({ csrf, command_key: '44444444-4444-4444-8444-444444444444', objective: 'Inspect the registry' }).toString();
    const form = await send(base, '/tasks/propose', proposal, headers);
    expect(form.status).toBe(303); expect(form.location).toContain('error=policy_unavailable_or_tampered');
    expect(tasks.proposed).toHaveLength(0);
    const json = await send(base, '/tasks/propose', JSON.stringify({ csrf, command_key: '44444444-4444-4444-8444-444444444444', objective: 'Inspect the registry' }),
      { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' });
    expect(json.status).toBe(503);
  });
  it('does not leak unexpected internal errors', async () => {
    const tasks = new StubTasks(); tasks.failPropose = true;
    const base = await start(tasks);
    const { cookie, csrf } = await login(base);
    const json = await send(base, '/tasks/propose', JSON.stringify({ csrf, command_key: '55555555-5555-4555-8555-555555555555', objective: 'Inspect the registry' }),
      { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' });
    expect(json.status).toBe(400);
    expect(json.text).not.toContain('private-marker');
    expect(JSON.parse(json.text)).toEqual({ error: 'owner_task_failed' });
  });
});
