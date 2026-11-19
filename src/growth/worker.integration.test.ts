import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { evaluate } from './agents.js';
import { GrowthRuntime } from './runtime.js';
import { GrowthWorker } from './worker.js';

const url = process.env.TEST_DATABASE_URL;
if (process.env.REQUIRE_DB_TESTS === 'true' && !url) throw new Error('TEST_DATABASE_URL_required');
if (url && process.env.CODEX_DB_TEST_ACK !== 'disposable-database-only') throw new Error('disposable_database_ack_required');
describe.runIf(Boolean(url))('growth worker against disposable PostgreSQL', () => {
  const schema = 'growth_worker_test_' + randomUUID().replaceAll('-', '');
  const input = { entered: 40, completed: 10, cohort: 'synthetic-cohort', transition: 'quote-to-order' };
  const sql = (text: string) => text.replaceAll('growth_runtime', schema);
  const query = (text: string, values?: unknown[]) => pool!.query(sql(text), values);
  let pool: Pool | undefined, runtime: GrowthRuntime, worker: GrowthWorker;
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 6, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
    // The 007 migration creates the schema itself; do not pre-create it.
    await pool.query(readFileSync(new URL('../../migrations/007_growth_runtime.sql', import.meta.url), 'utf8').replaceAll('growth_runtime', schema));
    // Routing adapter only: real connections and queries against the isolated test schema.
    const isolated = {
      query,
      connect: async () => {
        const client = await pool!.connect();
        return { query: (text: string, values?: unknown[]) => client.query(sql(text), values), release: () => client.release() };
      },
    } as unknown as Pool;
    runtime = new GrowthRuntime(isolated);
    worker = new GrowthWorker(runtime, { name: 'worker-test', pollMs: 100 });
  });
  beforeEach(async () => {
    await query('TRUNCATE growth_runtime.events,growth_runtime.runs');
    await query('UPDATE growth_runtime.policy SET paused=true');
  });
  afterAll(async () => { if (pool) { try { await pool.query('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE'); } finally { await pool.end(); } } });
  it('rejects invalid worker names and poll intervals', () => {
    expect(() => new GrowthWorker(runtime, { name: 'bad name!', pollMs: 100 })).toThrow('invalid_worker');
    expect(() => new GrowthWorker(runtime, { name: 'ok', pollMs: 10 })).toThrow('invalid_poll_interval');
  });
  it('idles while paused without consuming attempts', async () => {
    await runtime.enqueue(randomUUID(), 'conversion', input);
    expect(await worker.step()).toBe('idle');
    const row = (await query('SELECT state, attempts FROM growth_runtime.runs')).rows[0];
    expect(row).toMatchObject({ state: 'queued', attempts: 0 });
  });
  it('claims and verifies queued runs when dispatch is resumed', async () => {
    await runtime.enqueue(randomUUID(), 'conversion', input);
    await query('UPDATE growth_runtime.policy SET paused=false');
    expect(await worker.step()).toBe('completed');
    const row = (await query('SELECT state, attempts, output FROM growth_runtime.runs')).rows[0];
    expect(row).toMatchObject({ state: 'verified', attempts: 1, output: evaluate('conversion', input) });
    expect(await worker.step()).toBe('idle');
  });
  it('reclaims and verifies an expired lease from a crashed worker', async () => {
    await runtime.enqueue(randomUUID(), 'conversion', input);
    await query('UPDATE growth_runtime.policy SET paused=false');
    const stale = await runtime.claim('crashed-worker');
    await query("UPDATE growth_runtime.runs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", [stale!.id]);
    expect(await worker.step()).toBe('completed');
    const row = (await query('SELECT state, attempts FROM growth_runtime.runs')).rows[0];
    expect(row).toMatchObject({ state: 'verified', attempts: 2 });
  });
  it('stops polling when aborted', async () => {
    const controller = new AbortController();
    const done = worker.run(controller.signal);
    controller.abort();
    await done;
    expect((await query('SELECT count(*)::int AS n FROM growth_runtime.runs')).rows[0].n).toBe(0);
  });
});
