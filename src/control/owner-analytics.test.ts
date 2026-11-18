import { describe, expect, it } from 'vitest';
import { ownerConsole, ownerOverview } from './owner-console.js';
import { PostgresAnalyticsStore, type PipelineSummary, type RevenueSummary } from './owner-analytics.js';
import { parseBalanceTransactions, syncStripeRevenue } from './owner-stripe-sync.js';

const data = () => ownerOverview('owner', '43dba41dffc44295fca86cfdb43f8b166f265769', 1000, 901000);
const revenue: RevenueSummary = {
  currency: 'USD', grossMinor: 100000, refundMinor: 5000, feeMinor: 3290, netMinor: 91710, eventCount: 7,
  byDay: [{ day: '2026-11-13', netMinor: 40000 }, { day: '2026-11-14', netMinor: -10000 }, { day: '2026-11-15', netMinor: 80000 }],
};
const pipeline: PipelineSummary = {
  stages: [
    { stage: 'new', count: 3, valueMinor: 15000 },
    { stage: 'qualified', count: 2, valueMinor: 20000 },
    { stage: 'engaged', count: 1, valueMinor: 7500 },
    { stage: 'won', count: 2, valueMinor: 90000 },
    { stage: 'lost', count: 1, valueMinor: 0 },
  ], leadCount: 9, wonValueMinor: 90000, conversionPercent: 22.2, currency: 'USD', currencies: ['USD'],
};

describe('analytics console views', () => {
  it('renders revenue KPIs, bar chart and the honest profit caveat', () => {
    const html = ownerConsole(data(), 'csrf', { view: 'revenue' }, undefined, { configured: true, revenue });
    expect(html).toContain('Gross charges');
    expect(html).toContain('$1,000.00');
    expect(html).toContain('bar-fill--neg');
    expect(html).toContain('not profit');
  });
  it('renders the pipeline funnel and conversion', () => {
    const html = ownerConsole(data(), 'csrf', { view: 'pipeline' }, undefined, { configured: true, pipeline });
    expect(html).toContain('qualified');
    expect(html).toContain('22.2%');
    expect(html).toContain('Won value');
  });
  it('shows fail-closed states when analytics are unconfigured or unavailable', () => {
    expect(ownerConsole(data(), 'csrf', { view: 'revenue' })).toContain('No revenue data yet');
    expect(ownerConsole(data(), 'csrf', { view: 'revenue' }, undefined, { configured: true, databaseUnavailable: true })).toContain('connectivity failure');
    expect(ownerConsole(data(), 'csrf', { view: 'pipeline' }, undefined, { configured: true })).toContain('No pipeline data yet');
  });
  it('adds the new views to navigation', () => {
    const html = ownerConsole(data(), 'csrf', {});
    expect(html).toContain('Revenue</a>');
    expect(html).toContain('Pipeline</a>');
  });
});

class FakePool {
  queries: Array<{ sql: string; params: unknown[] }> = [];
  constructor(private readonly results: Array<{ rows: unknown[]; rowCount: number }>) {}
  async query(sql: string, params?: unknown[]) {
    this.queries.push({ sql, params: params ?? [] });
    const next = this.results.shift();
    if (!next) throw new Error('unexpected query');
    return next;
  }
}

describe('analytics store', () => {
  it('summarizes revenue from query results including bigint strings', async () => {
    const pool = new FakePool([
      { rows: [{ currency: 'usd', gross: '100000', refunds: '5000', fees: '3290', net: '91710', events: 7 }], rowCount: 1 },
      { rows: [{ day: '2026-11-15', net: '80000' }], rowCount: 1 },
    ]);
    const store = new PostgresAnalyticsStore(pool as never, 'owner_test');
    const summary = await store.revenueSummary(30);
    expect(summary.currency).toBe('USD');
    expect(summary.grossMinor).toBe(100000);
    expect(summary.netMinor).toBe(91710);
    expect(summary.byDay[0].netMinor).toBe(80000);
  });
  it('builds the pipeline with conversion from stage counts', async () => {
    const pool = new FakePool([
      { rows: [{ stage: 'new', currency: 'usd', count: 3, value: '15000' }, { stage: 'won', currency: 'usd', count: 2, value: '90000' }], rowCount: 2 },
    ]);
    const store = new PostgresAnalyticsStore(pool as never, 'owner_test');
    const pipeline = await store.pipeline();
    expect(pipeline.leadCount).toBe(5);
    expect(pipeline.conversionPercent).toBe(40);
    expect(pipeline.stages.find(s => s.stage === 'won')?.count).toBe(2);
    expect(pipeline.stages.find(s => s.stage === 'engaged')?.count).toBe(0);
  });
  it('upserts revenue events idempotently and validates inputs', async () => {
    const pool = new FakePool([{ rows: [{ event_id: 'txn_1' }], rowCount: 1 }, { rows: [], rowCount: 0 }]);
    const store = new PostgresAnalyticsStore(pool as never, 'owner_test');
    const inserted = await store.upsertRevenueEvents([
      { eventId: 'txn_1', kind: 'charge', occurredAt: new Date(0), grossMinor: 100, netMinor: 97, currency: 'usd', description: 'x' },
    ]);
    expect(inserted).toBe(1);
    await expect(store.upsertRevenueEvents([
      { eventId: '', kind: 'charge', occurredAt: new Date(0), grossMinor: 0, netMinor: 0, currency: 'usd', description: '' },
    ])).rejects.toThrow('analytics_unavailable');
  });
});

const stripePage = (ids: string[], hasMore = false) => JSON.stringify({
  object: 'list', has_more: hasMore,
  data: ids.map((id, i) => ({ id, object: 'balance_transaction', amount: 1000 + i, net: 900 + i, currency: 'usd',
    type: i % 2 === 1 ? 'refund' : 'charge', created: 1763000000 + i, description: 'Test ' + i })),
});

describe('stripe sync', () => {
  it('maps balance transactions to revenue events with kinds and minor units', () => {
    const parsed = parseBalanceTransactions(stripePage(['txn_1', 'txn_2']));
    expect(parsed.events).toHaveLength(2);
    expect(parsed.events[0]).toMatchObject({ eventId: 'txn_1', kind: 'charge', grossMinor: 1000, netMinor: 900, currency: 'USD' });
    expect(parsed.events[1].kind).toBe('refund');
  });
  it('paginates with starting_after and reports inserted counts', async () => {
    const paths: string[] = [];
    const inserted: number[] = [];
    const store = {
      revenueSummary: async () => { throw new Error('unused'); },
      pipeline: async () => { throw new Error('unused'); },
      upsertRevenueEvents: async (events: Array<{ eventId: string }>) => { inserted.push(events.length); return events.length; },
      addLead: async () => { throw new Error('unused'); },
    };
    const result = await syncStripeRevenue({
      key: 'rk_test_1234567890abcdef', store,
      fetcher: async path => {
        paths.push(path);
        return { status: 200, body: path.includes('starting_after') ? stripePage(['txn_3']) : stripePage(['txn_1', 'txn_2'], true) };
      },
      maxPages: 3,
    });
    expect(paths[1]).toContain('starting_after=txn_2');
    expect(result).toEqual({ inserted: 3, fetched: 3 });
    expect(inserted).toEqual([2, 1]);
  });
  it('fails closed on non-200 responses and malformed payloads', async () => {
    const store = {} as never;
    await expect(syncStripeRevenue({
      key: 'rk_test_1234567890abcdef', store,
      fetcher: async () => ({ status: 401, body: '{"error":{"message":"auth"}}' }),
    })).rejects.toThrow('stripe_sync_failed');
    expect(() => parseBalanceTransactions('not json')).toThrow('stripe_sync_failed');
    expect(() => parseBalanceTransactions('{"object":"list","data":"nope"}')).toThrow('stripe_sync_failed');
    await expect(syncStripeRevenue({ key: 'not-a-key', store: {} as never, fetcher: async () => ({ status: 200, body: '{}' }) })).rejects.toThrow('stripe_sync_failed');
  });
});
