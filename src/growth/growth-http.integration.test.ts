import { randomUUID, scryptSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createOwnerControlApp } from '../control/owner-app.js';
import { GrowthRuntime } from './runtime.js';

const baseline = 'ea8bf2311c4ccf71af92b9aa3d09ac0cfda22e1e';
const password = 'synthetic-dashboard-password';
const origin = 'https://owner.example.test';
const saltHex = '12'.repeat(16);
const url = process.env.TEST_DATABASE_URL;
if (process.env.REQUIRE_DB_TESTS === 'true' && !url) throw new Error('TEST_DATABASE_URL_required');
if (url && process.env.CODEX_DB_TEST_ACK !== 'disposable-database-only') throw new Error('disposable_database_ack_required');
describe.runIf(Boolean(url))('owner growth routes against disposable PostgreSQL', () => {
  const schema = 'growth_http_test_' + randomUUID().replaceAll('-', '');
  const input = { entered: 40, completed: 10, cohort: 'synthetic-cohort', transition: 'quote-to-order' };
  const sql = (text: string) => text.replaceAll('growth_runtime', schema);
  const query = (text: string, values?: unknown[]) => pool!.query(sql(text), values);
  let pool: Pool | undefined, runtime: GrowthRuntime, owner: string;
  let created = false;
  const servers: Server[] = [];
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 6, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
    // The 007 migration creates the schema itself; do not pre-create it.
    await pool.query(readFileSync(new URL('../../migrations/007_growth_runtime.sql', import.meta.url), 'utf8').replaceAll('growth_runtime', schema));
    created = true;
    // Routing adapter only: real connections and queries against the isolated test schema.
    const isolated = {
      query,
      connect: async () => {
        const client = await pool!.connect();
        return { query: (text: string, values?: unknown[]) => client.query(sql(text), values), release: () => client.release() };
      },
    } as unknown as Pool;
    runtime = new GrowthRuntime(isolated);
  });
  beforeEach(async () => {
    owner = 'owner-' + randomUUID();
    await query('TRUNCATE growth_runtime.events,growth_runtime.runs');
    await query('UPDATE growth_runtime.policy SET paused=true');
  });
  afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => { server.closeAllConnections(); server.close(error => error ? reject(error) : resolve()); }))); });
  afterAll(async () => { if (pool) { try { if (created) await pool.query('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE'); } finally { await pool.end(); } } });
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
  async function ready(withGrowth = true) {
    const config = { origin, owner, saltHex,
      hashHex: scryptSync(password, Buffer.from(saltHex, 'hex'), 64).toString('hex'), revision: baseline };
    const server = (withGrowth ? createOwnerControlApp(config, Date.now, undefined, undefined, undefined, undefined, undefined, runtime)
      : createOwnerControlApp(config, Date.now)).listen(0, '127.0.0.1');
    servers.push(server);
    await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const login = await send(base, '/login', new URLSearchParams({ owner, password }).toString(),
      { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' });
    const cookie = login.cookie.split(';')[0];
    const page = await send(base, '/', undefined, { Cookie: cookie });
    const csrf = /name=csrf value="([^"]+)"/.exec(page.text)?.[1];
    if (login.status !== 303 || !csrf) throw new Error('fixture_setup_failed');
    return { base, headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }, csrf };
  }
  it('blocks unauthenticated, cross-origin and forged requests without persisting runs', async () => {
    const { base, headers, csrf } = await ready();
    expect((await send(base, '/api/growth/runs')).status).toBe(401);
    const payload = JSON.stringify({ csrf, commandKey: randomUUID(), role: 'conversion', input });
    expect((await send(base, '/api/growth/runs', payload, { ...headers, Origin: 'https://attacker.example.test' })).status).toBe(403);
    expect((await send(base, '/api/growth/runs', JSON.stringify({ csrf: 'forged-csrf-token-value', commandKey: randomUUID(), role: 'conversion', input }), headers)).status).toBe(403);
    expect((await send(base, '/api/growth/runs', JSON.stringify({ commandKey: randomUUID(), role: 'conversion', input }), headers)).status).toBe(403);
    expect((await query('SELECT count(*)::int AS n FROM growth_runtime.runs')).rows[0].n).toBe(0);
  });
  it('serves the proposal queue to an authenticated owner', async () => {
    const { base, headers } = await ready();
    const api = await send(base, '/api/growth/runs', undefined, { Cookie: headers.Cookie });
    expect(api.status).toBe(200);
    const state = JSON.parse(api.text);
    expect(state.mode).toBe('proposal_only');
    expect(state.runs).toHaveLength(0);
  });
  it('records an idempotent proposal through the owner session', async () => {
    const { base, headers, csrf } = await ready();
    const body = JSON.stringify({ csrf, commandKey: randomUUID(), role: 'conversion', input });
    const first = await send(base, '/api/growth/runs', body, headers);
    expect(first.status).toBe(202);
    const id = JSON.parse(first.text).id;
    const second = await send(base, '/api/growth/runs', body, headers);
    expect(second.status).toBe(202);
    expect(JSON.parse(second.text).id).toBe(id);
    const rows = (await query('SELECT state, attempts, role FROM growth_runtime.runs')).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ state: 'queued', attempts: 0, role: 'conversion' });
    const api = await send(base, '/api/growth/runs', undefined, { Cookie: headers.Cookie });
    expect(JSON.parse(api.text).runs[0].id).toBe(id);
  });
  it('rejects invalid roles and conflicting commands without side effects', async () => {
    const { base, headers, csrf } = await ready();
    expect((await send(base, '/api/growth/runs', JSON.stringify({ csrf, commandKey: randomUUID(), role: 'admin', input }), headers)).status).toBe(400);
    const key = randomUUID();
    expect((await send(base, '/api/growth/runs', JSON.stringify({ csrf, commandKey: key, role: 'conversion', input }), headers)).status).toBe(202);
    expect((await send(base, '/api/growth/runs', JSON.stringify({ csrf, commandKey: key, role: 'conversion', input: { ...input, completed: 11 } }), headers)).status).toBe(400);
    expect((await query('SELECT count(*)::int AS n FROM growth_runtime.runs')).rows[0].n).toBe(1);
  });
  it('leaves growth routes unmounted when no runtime is configured', async () => {
    const { base, headers } = await ready(false);
    expect((await send(base, '/api/growth/runs', undefined, { Cookie: headers.Cookie })).status).toBe(404);
  });
});
