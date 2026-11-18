import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { loadTools } from '../load-tools.js';
import { ApiError, digest, type Dependencies } from './api.js';
import { PostgresCommerce } from './postgres-commerce.js';
import { createSnapshotQuoteSandboxApp } from './snapshot-quote-tool.js';

const url = process.env.TEST_DATABASE_URL;
if (process.env.REQUIRE_DB_TESTS === 'true' && !url) throw new Error('TEST_DATABASE_URL_required');
if (url) {
  if (process.env.CODEX_DB_TEST_ACK !== 'disposable-database-only') throw new Error('disposable_database_ack_required');
  const parsed = new URL(url);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) ||
      parsed.search || parsed.hash) {
    throw new Error('local_postgres_test_database_required');
  }
}

describe.runIf(Boolean(url))('pricing snapshot: SDK to HTTP to real PostgreSQL', () => {
  const schema = `quote_mcp_test_${randomUUID().replaceAll('-', '')}`;
  const a = randomUUID(), b = randomUUID();
  const issuer = 'https://synthetic-issuer.example.test';
  const scopes = ['commerce:quote', 'services:execute', 'jobs:read', 'results:read'];
  let pool: Pool, backend: PostgresCommerce, server: Server | undefined, endpoint: URL;
  let created = false;
  let baseline: unknown;
  const clients: Client[] = [];

  async function state() {
    const wallets = (await pool.query(`SELECT * FROM ${schema}.wallets ORDER BY buyer_id`)).rows;
    const ledger = (await pool.query(`SELECT * FROM ${schema}.ledger ORDER BY id`)).rows;
    const budgets = (await pool.query(`SELECT buyer_id,client_id,reserved_minor,spent_minor FROM ${schema}.delegations ORDER BY buyer_id,client_id`)).rows;
    const counts: Record<string, number> = {};
    for (const table of ['jobs', 'reservations', 'outbox', 'results']) {
      counts[table] = (await pool.query(`SELECT count(*)::int AS n FROM ${schema}.${table}`)).rows[0].n;
    }
    return { wallets, ledger, budgets, counts };
  }
  async function quoteCount() {
    return (await pool.query(`SELECT count(*)::int AS n FROM ${schema}.quotes`)).rows[0].n;
  }
  async function connect(token: string) {
    const client = new Client({ name: 'real-pg-quote-test', version: '1.0.0' });
    clients.push(client);
    await client.connect(new StreamableHTTPClientTransport(endpoint, { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    return client;
  }
  async function call(client: Client, sourceId: string, extra: Record<string, unknown> = {}) {
    const result = await client.callTool({ name: 'codex_service_quote', arguments: {
      service: 'pricing_snapshot', input: { sourceId }, ...extra
    } });
    const content = result.content as Array<{ type: string; text?: string }>;
    const text = content.find(c => c.type === 'text')?.text;
    if (!text) throw new Error('missing_test_content');
    return { failed: result.isError === true, data: JSON.parse(text) };
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 8, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
    const sql = readFileSync(new URL('../../migrations/standalone_commerce_v1.sql', import.meta.url), 'utf8').replaceAll('agent_commerce', schema);
    const c = await pool.connect();
    try { await c.query(sql); created = true; }
    catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; }
    finally { c.release(); }
    backend = new PostgresCommerce(pool, schema);
  }, 30000);

  beforeEach(async () => {
    baseline = undefined;
    await pool.query(`TRUNCATE ${schema}.buyers,${schema}.prices CASCADE`);
    for (const [id, subject] of [[a, 'alice'], [b, 'bob']]) {
      await pool.query(`INSERT INTO ${schema}.buyers(id,issuer,subject,active,currency) VALUES($1,$2,$3,true,'USD')`, [id, issuer, subject]);
      await pool.query(`INSERT INTO ${schema}.delegations(buyer_id,client_id,active,expires_at,scopes,services,limit_minor,max_open_jobs) VALUES($1,'agent',true,clock_timestamp()+interval '1 hour',$2,$3,10000,10)`, [id, scopes, ['pricing_snapshot']]);
      await pool.query(`INSERT INTO ${schema}.wallets(buyer_id,available_minor) VALUES($1,2000)`, [id]);
      await pool.query(`INSERT INTO ${schema}.ledger(buyer_id,kind,available_delta,held_delta,external_ref) VALUES($1,'fund',2000,0,$2)`, [id, `synthetic:${id}`]);
      await pool.query(`INSERT INTO ${schema}.resources(buyer_id,kind,id,ready) VALUES($1,'source','shared-id',true)`, [id]);
    }
    await pool.query(`INSERT INTO ${schema}.resources(buyer_id,kind,id,ready) VALUES($1,'source','bob-only',true),($2,'source','alice-not-ready',false)`, [b,a]);
    await pool.query(`INSERT INTO ${schema}.prices(service,version,currency,amount_minor,enabled) VALUES('pricing_snapshot','synthetic-v1','USD',250,true)`);
    baseline = await state();
    const commerce: Dependencies = { enabled: true, backend,
      authenticate: async token => {
        const subject = token === 'synthetic-a' ? 'alice' : token === 'synthetic-b' ? 'bob' : undefined;
        if (!subject) throw new ApiError(401, 'unauthorized');
        return backend.resolve(issuer, { buyerId: subject, clientId: 'agent', scopes });
      },
      consume: async () => ({ allowed: true, retryAfter: 0 })
    };
    const app = createSnapshotQuoteSandboxApp({ tools: loadTools(), commerce,
      dispatch: async () => { throw new Error('unexpected_fallback'); },
      storefrontRouter: (_req,_res,next) => next(), pricingRoute: '/disabled-test-pricing',
      catalog: { catalog_version: 'synthetic', offers: [] }, agentCardJson: '{}' });
    server = app.listen(0, '127.0.0.1');
    const running = server;
    await new Promise<void>((resolve,reject) => { running.once('listening', resolve); running.once('error', reject); });
    endpoint = new URL('/mcp', `http://127.0.0.1:${(running.address() as AddressInfo).port}`);
  }, 30000);

  afterEach(async () => {
    try { if (baseline !== undefined) expect(await state()).toEqual(baseline); }
    finally {
      await Promise.allSettled(clients.splice(0).map(c => c.close()));
      const running = server; server = undefined;
      if (running) await new Promise<void>((resolve,reject) => {
        running.closeAllConnections(); running.close(e => e ? reject(e) : resolve());
      });
    }
  }, 30000);
  afterAll(async () => {
    if (pool) try { if (created) await pool.query(`DROP SCHEMA "${schema}" CASCADE`); }
    finally { await pool.end(); }
  }, 30000);

  it('discovers the quote tool and persists configured price, ownership, digest and exact returned expiry', async () => {
    const client = await connect('synthetic-a');
    expect((await client.listTools()).tools.some(t => t.name === 'codex_service_quote')).toBe(true);
    const before = (await pool.query('SELECT clock_timestamp()::text AS t')).rows[0].t;
    const reply = await call(client, 'shared-id');
    const after = (await pool.query('SELECT clock_timestamp()::text AS t')).rows[0].t;
    expect(reply.failed).toBe(false);
    expect(reply.data).toMatchObject({ service: 'pricing_snapshot', amountMinor: 250, currency: 'USD' });
    const row = (await pool.query(`SELECT *,expires_at >= $2::timestamptz + interval '5 minutes' AND expires_at <= $3::timestamptz + interval '5 minutes' AS correct_ttl FROM ${schema}.quotes WHERE id=$1`, [reply.data.id,before,after])).rows[0];
    expect(row).toMatchObject({ buyer_id: a, client_id: 'agent', service: 'pricing_snapshot',
      input: { sourceId: 'shared-id' }, price_version: 'synthetic-v1', amount_minor: 250, currency: 'USD',
      input_digest: digest({ service: 'pricing_snapshot', input: { sourceId: 'shared-id' } }), correct_ttl: true });
    expect(row.expires_at.toISOString()).toBe(reply.data.expiresAt);
    expect(await quoteCount()).toBe(1);
  });

  it('isolates concurrent buyers even when their local source IDs match', async () => {
    const [alice,bob] = await Promise.all([connect('synthetic-a'),connect('synthetic-b')]);
    const replies = await Promise.all([call(alice,'shared-id'),call(bob,'shared-id')]);
    expect(replies.every(r => !r.failed)).toBe(true);
    expect(new Set(replies.map(r => r.data.id)).size).toBe(2);
    for (const [index,buyer] of [a,b].entries()) {
      const row = (await pool.query(`SELECT buyer_id,client_id FROM ${schema}.quotes WHERE id=$1`, [replies[index].data.id])).rows[0];
      expect(row).toEqual({ buyer_id: buyer, client_id: 'agent' });
    }
  });

  it('makes foreign, missing and not-ready sources indistinguishable and creates no quotes', async () => {
    const client = await connect('synthetic-a');
    for (const source of ['bob-only','missing-source','alice-not-ready']) {
      const reply = await call(client,source);
      expect(reply.failed).toBe(true); expect(reply.data).toEqual({ error: { code: 'not_found', retryable: false } });
    }
    expect(await quoteCount()).toBe(0);
  });

  it('uses updated configured prices without rewriting existing quotes', async () => {
    const client = await connect('synthetic-a'); const first = await call(client,'shared-id');
    expect(first.failed).toBe(false);
    await pool.query(`UPDATE ${schema}.prices SET amount_minor=375,version='synthetic-v2' WHERE service='pricing_snapshot'`);
    const second = await call(client,'shared-id'); expect(second.failed).toBe(false);
    expect(first.data.amountMinor).toBe(250); expect(second.data.amountMinor).toBe(375);
    for (const [reply,amount,version] of [[first,250,'synthetic-v1'],[second,375,'synthetic-v2']] as const) {
      expect((await pool.query(`SELECT amount_minor,price_version FROM ${schema}.quotes WHERE id=$1`, [reply.data.id])).rows[0]).toEqual({ amount_minor: amount, price_version: version });
    }
  });

  it.each(['missing','disabled','currency-mismatch'])('rejects %s pricing without quote or financial writes', async mode => {
    if (mode === 'missing') await pool.query(`DELETE FROM ${schema}.prices`);
    else if (mode === 'disabled') await pool.query(`UPDATE ${schema}.prices SET enabled=false`);
    else await pool.query(`UPDATE ${schema}.prices SET currency='EUR'`);
    const reply = await call(await connect('synthetic-a'),'shared-id');
    expect(reply.failed).toBe(true); expect(reply.data.error.code).toBe('service_unpriced');
    expect(await quoteCount()).toBe(0);
  });

  it('rejects caller identity and price injection before quote persistence', async () => {
    const client = await connect('synthetic-a');
    for (const extra of [{ buyerId: b }, { amountMinor: 1 }, { currency: 'EUR' }]) {
      const reply = await call(client,'shared-id',extra);
      expect(reply.failed).toBe(true); expect(reply.data.error.code).toBe('invalid_request');
    }
    expect(await quoteCount()).toBe(0);
  });
});
