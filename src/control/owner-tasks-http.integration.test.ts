import { randomUUID, scryptSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createOwnerControlApp } from './owner-app.js';
import { OwnerTaskQueue, registryReport } from './owner-task-queue.js';
import { OwnerGovernance, defaultDispatchPolicyDocument } from './owner-governance.js';

const baseline = 'ea8bf2311c4ccf71af92b9aa3d09ac0cfda22e1e';
const password = 'synthetic-dashboard-password';
const origin = 'https://owner.example.test';
const saltHex = '12'.repeat(16);
const url = process.env.TEST_DATABASE_URL;
if (process.env.REQUIRE_DB_TESTS === 'true' && !url) throw new Error('TEST_DATABASE_URL_required');
if (url && process.env.CODEX_DB_TEST_ACK !== 'disposable-database-only') throw new Error('disposable_database_ack_required');
describe.runIf(Boolean(url))('dashboard task controls against disposable PostgreSQL', () => {
  const schema = 'owner_test_' + randomUUID().replaceAll('-', '');
  let pool: Pool | undefined, queue: OwnerTaskQueue, governance: OwnerGovernance, owner: string;
  let created = false;
  const servers: Server[] = [];
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 6, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
    await pool.query('CREATE SCHEMA "' + schema + '"'); created = true;
    for (const file of ['003_owner_tasks.sql', '004_owner_governance.sql'])
      await pool.query(readFileSync(new URL('../../migrations/' + file, import.meta.url), 'utf8').replaceAll('owner_control', schema));
  });
  beforeEach(async () => {
    owner = 'owner-' + randomUUID();
    queue = new OwnerTaskQueue(pool!, owner, schema); await queue.initialize();
    governance = new OwnerGovernance(pool!, owner, schema);
    await governance.seedInitialPolicy('owner_task_dispatch', defaultDispatchPolicyDocument());
  });
  afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => { server.closeAllConnections(); server.close(error => error ? reject(error) : resolve()); }))); });
  afterAll(async () => { if (pool) { try { if (created) await pool.query('DROP SCHEMA "' + schema + '" CASCADE'); } finally { await pool.end(); } } });
  function send(base: string, path: string, body?: string, headers: Record<string, string> = {}) {
    return new Promise<{ status: number; text: string; cookie: string }>((resolve, reject) => {
      const req = request(new URL(path, base), { agent: false, method: body === undefined ? 'GET' : 'POST',
        headers: { ...(body === undefined ? {} : { 'Content-Length': Buffer.byteLength(body) }), ...headers } }, res => {
        let text = ''; res.setEncoding('utf8'); res.on('data', chunk => { text += chunk; });
        res.on('error', reject);
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text, cookie: res.headers['set-cookie']?.[0] ?? '' }));
      });
      req.setTimeout(5000, () => req.destroy(new Error('fixture_timeout')));
      req.on('error', reject); req.end(body);
    });
  }
  async function ready() {
    const server = createOwnerControlApp({ origin, owner, saltHex,
      hashHex: scryptSync(password, Buffer.from(saltHex, 'hex'), 64).toString('hex'), revision: baseline }, Date.now, queue, governance).listen(0, '127.0.0.1');
    servers.push(server);
    await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const login = await send(base, '/login', new URLSearchParams({ owner, password }).toString(),
      { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' });
    const cookie = login.cookie.split(';')[0];
    const page = await send(base, '/', undefined, { Cookie: cookie });
    const csrf = /name=csrf value="([^"]+)"/.exec(page.text)?.[1];
    if (login.status !== 303 || !csrf) throw new Error('fixture_setup_failed');
    return { base, headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' }, csrf };
  }
  it('serves live queue state and records proposals durably', async () => {
    const { base, headers, csrf } = await ready();
    const api = await send(base, '/api/tasks', undefined, { Cookie: headers.Cookie });
    expect(api.status).toBe(200);
    const state = JSON.parse(api.text);
    expect(state.configured).toBe(true); expect(state.paused).toBe(true); expect(state.tasks).toHaveLength(0);
    const key = randomUUID();
    const proposal = new URLSearchParams({ csrf, command_key: key, objective: 'Inspect the committed service registry' }).toString();
    expect((await send(base, '/tasks/propose', proposal, headers)).status).toBe(303);
    const view = await queue.view();
    expect(view.tasks[0].command_key).toBe(key); expect(view.tasks[0].state).toBe('proposed');
    const governed = await pool!.query('SELECT count(*)::int AS n FROM "' + schema + '".governance_events WHERE owner_id=$1', [owner]);
    expect(governed.rows[0].n).toBeGreaterThan(0);
    expect(await governance.verifyChain(100)).toBe(true);
  });
  it('requires owner approval before dispatch and persists pause/resume', async () => {
    const { base, headers, csrf } = await ready();
    const task = await queue.propose(randomUUID(), 'Inspect the committed service registry', baseline);
    expect((await send(base, '/tasks/approve', new URLSearchParams({ csrf, task: task.id }).toString(), headers)).status).toBe(303);
    expect((await queue.view()).tasks[0].state).toBe('queued');
    const approvals = await pool!.query('SELECT count(*)::int AS n FROM "' + schema + '".approvals WHERE owner_id=$1', [owner]);
    expect(approvals.rows[0].n).toBe(1);
    expect((await send(base, '/tasks/resume', new URLSearchParams({ csrf }).toString(), headers)).status).toBe(303);
    expect((await queue.view()).paused).toBe(false);
    expect((await send(base, '/tasks/pause', new URLSearchParams({ csrf }).toString(), headers)).status).toBe(303);
    expect((await queue.view()).paused).toBe(true);
  });
  it('shows verifier outcomes after separate worker and verifier runs', async () => {
    const { base, headers } = await ready();
    const task = await queue.propose(randomUUID(), 'Inspect the committed service registry', baseline);
    await queue.approve(task.id); await queue.pause(false);
    const claim = (await queue.claim('registry-observer'))!;
    await queue.submit(claim, registryReport(baseline));
    let page = await send(base, '/?view=tasks', undefined, { Cookie: headers.Cookie });
    expect(page.text).toContain('awaiting_verification');
    expect(await queue.verify(task.id, 'registry-verifier', baseline)).toBe(true);
    page = await send(base, '/?view=tasks', undefined, { Cookie: headers.Cookie });
    expect(page.text).toContain('>verified<');
    expect(page.text).toContain('registry-verifier');
  });
  it('cancels from the dashboard and fences late worker results', async () => {
    const { base, headers, csrf } = await ready();
    const task = await queue.propose(randomUUID(), 'Inspect the committed service registry', baseline);
    await queue.approve(task.id); await queue.pause(false);
    const claim = (await queue.claim('registry-observer'))!;
    expect((await send(base, '/tasks/cancel', new URLSearchParams({ csrf, task: task.id }).toString(), headers)).status).toBe(303);
    await expect(queue.submit(claim, registryReport(baseline))).rejects.toThrow('stale_or_cancelled_claim');
    expect((await queue.view()).tasks[0].state).toBe('cancelled');
  });
  it('isolates owners', async () => {
    const { base, headers, csrf } = await ready();
    const other = new OwnerTaskQueue(pool!, 'other-' + randomUUID(), schema); await other.initialize();
    expect((await other.view()).tasks).toHaveLength(0);
    const key = randomUUID();
    expect((await send(base, '/tasks/propose', new URLSearchParams({ csrf, command_key: key, objective: 'Inspect the committed service registry' }).toString(), headers)).status).toBe(303);
    expect((await other.view()).tasks).toHaveLength(0);
    expect((await queue.view()).tasks[0].command_key).toBe(key);
  });
});
