import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresAnalyticsStore } from './owner-analytics.js';
import { expectedBalanceActivity, reconciliationAsOf, reconciliationEvents } from './fixtures/owner-reconciliation.js';

const url = process.env.TEST_DATABASE_URL;
if (process.env.REQUIRE_DB_TESTS === 'true' && !url) throw new Error('TEST_DATABASE_URL_required');
if (url && process.env.CODEX_DB_TEST_ACK !== 'disposable-database-only') throw new Error('disposable_database_ack_required');
describe.runIf(Boolean(url))('owner analytics real PostgreSQL reconciliation', () => {
  const schema = 'owner_test_' + randomUUID().replaceAll('-', '');
  let pool: Pool;
  let store: PostgresAnalyticsStore;
  let created = false;
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 4, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
    await pool.query('CREATE SCHEMA "' + schema + '"');
    created = true;
    for (const file of ['005_owner_analytics.sql', '006_owner_lead_transitions.sql']) {
      await pool.query(readFileSync(new URL('../../migrations/' + file, import.meta.url), 'utf8').replaceAll('owner_control', schema));
    }
    // Execute production SQL against PostgreSQL with a fixed reporting clock.
    // No query results are mocked. Only the literal now() expression is replaced.
    const fixedClockPool = { query: (text: string, values?: unknown[]) => pool.query(text.replaceAll('now()', "TIMESTAMPTZ '" + reconciliationAsOf + "'"), values) };
    store = new PostgresAnalyticsStore(fixedClockPool as unknown as Pick<Pool, 'query'>, schema);
    await store.upsertRevenueEvents(reconciliationEvents());
  });
  afterAll(async () => {
    if (pool) {
      try { if (created) await pool.query('DROP SCHEMA "' + schema + '" CASCADE'); }
      finally { await pool.end(); }
    }
  });
  it('applies migrations 005 and 006 with the lead receipt foreign key', async () => {
    const result = await pool.query('SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid = $1::regclass AND contype = $2', [schema + '.owner_lead_transition_events', 'f']);
    expect(result.rows[0].n).toBe(1);
  });
  it('reconciles stored balance activity independently by currency', async () => {
    const result = await pool.query('SELECT currency, sum(net_minor)::text AS net FROM "' + schema + '".owner_revenue_events GROUP BY currency ORDER BY currency');
    expect(result.rows).toEqual([{ currency: 'EUR', net: '4800' }, { currency: 'USD', net: '7700' }]);
  });
  it('replays identical source events without additional rows', async () => {
    expect(await store.upsertRevenueEvents(reconciliationEvents())).toBe(0);
    const result = await pool.query('SELECT count(*)::int AS n FROM "' + schema + '".owner_revenue_events');
    expect(result.rows[0].n).toBe(3);
  });
  it('keeps the daily chart in the same currency as its selected totals', async () => {
    const summary = await store.revenueSummary(30);
    expect(summary.currency).toBe('USD');
    expect(summary).toMatchObject(expectedBalanceActivity.USD);
    expect(summary.byDay).toEqual([{ day: '2026-01-14', netMinor: 7700 }]);
  });
});
