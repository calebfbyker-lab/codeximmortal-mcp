import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresOwnerCommerceOrders } from './owner-commerce-orders.js';
const url = process.env.TEST_DATABASE_URL;
if (process.env.REQUIRE_DB_TESTS === 'true' && !url) throw new Error('TEST_DATABASE_URL_required');
if (url && process.env.CODEX_DB_TEST_ACK !== 'disposable-database-only') throw new Error('disposable_database_ack_required');
describe.runIf(Boolean(url))('owner order projection real PostgreSQL', () => {
  const schema = 'orders_test_' + randomUUID().replaceAll('-', '');
  let pool: Pool; let store: PostgresOwnerCommerceOrders; let created = false;
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
    const c = await pool.connect();
    try { await c.query(readFileSync(new URL('../../migrations/standalone_commerce_v1.sql', import.meta.url), 'utf8').replaceAll('agent_commerce', schema)); created = true; }
    catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; } finally { c.release(); }
    store = new PostgresOwnerCommerceOrders(pool, schema);
    await pool.query(`INSERT INTO ${schema}.prices VALUES('pricing_snapshot','synthetic-v1','USD',100,false)`);
    for (const [i, status, currency, state] of [[1,'queued','USD','held'], [2,'succeeded','EUR','consumed'], [3,'failed','USD','released']] as const) {
      const buyer = randomUUID(); const id = 'job-' + i; const quote = 'quote-' + i;
      await pool.query(`INSERT INTO ${schema}.buyers VALUES($1,'https://issuer.example.test',$2,false,$3)`, [buyer, 'buyer-' + i, currency]);
      await pool.query(`INSERT INTO ${schema}.delegations(buyer_id,client_id,expires_at,limit_minor,max_open_jobs) VALUES($1,'client',clock_timestamp()+interval '1 hour',1000,10)`, [buyer]);
      await pool.query(`INSERT INTO ${schema}.quotes VALUES($1,$2,'client','pricing_snapshot','{}',$3,'synthetic-v1',$4,100,clock_timestamp()+interval '1 hour')`, [quote,buyer,'a'.repeat(64),currency]);
      await pool.query(`INSERT INTO ${schema}.jobs(id,buyer_id,client_id,service,input,quote_id,idempotency_key,request_digest,amount_minor,currency,status) VALUES($1,$2,'client','pricing_snapshot','{}',$3,$4,$5,100,$6,$7)`, [id,buyer,quote,'synthetic_key_000' + i,'a'.repeat(64),currency,status]);
      await pool.query(`INSERT INTO ${schema}.reservations VALUES($1,$2,100)`, [id,state]);
      if (status === 'succeeded') await pool.query(`INSERT INTO ${schema}.results VALUES($1,'{"private":"not projected"}','receipt-2')`, [id]);
    }
  }, 30000);
  afterAll(async () => { if (pool) { try { if (created) await pool.query(`DROP SCHEMA "${schema}" CASCADE`); } finally { await pool.end(); } } });
  it('returns one row per job across buyers with exact currency and optional receipt', async () => {
    const { orders } = await store.list();
    expect(orders).toHaveLength(3); expect(new Set(orders.map(o => o.buyerId)).size).toBe(3);
    expect(orders.find(o => o.jobId === 'job-2')).toMatchObject({ currency: 'EUR', amountMinor: '100', receiptId: 'receipt-2', reservationState: 'consumed' });
    expect(orders.find(o => o.jobId === 'job-1')).toMatchObject({ status: 'queued', receiptId: null, reservationState: 'held' });
    expect(orders.find(o => o.jobId === 'job-3')).toMatchObject({ status: 'failed', receiptId: null, reservationState: 'released' });
    expect(JSON.stringify(orders)).not.toContain('not projected');
    expect(orders.every(o => o.attribution === 'unknown' && o.paymentEvidence === 'not_evaluated')).toBe(true);
  });
  it('honors SQL row bounds and deterministic job-ID ordering', async () => {
    expect((await store.list(1)).orders.map(o => o.jobId)).toEqual(['job-3']);
  });
  it('is compatible with a PostgreSQL read-only transaction', async () => {
    const c = await pool.connect();
    try { await c.query('BEGIN READ ONLY');
      const readonlyStore = new PostgresOwnerCommerceOrders(c as unknown as Pick<Pool, 'query'>, schema);
      expect((await readonlyStore.list()).orders).toHaveLength(3);
      await c.query('ROLLBACK');
    } finally { await c.query('ROLLBACK').catch(() => undefined); c.release(); }
  });
});
