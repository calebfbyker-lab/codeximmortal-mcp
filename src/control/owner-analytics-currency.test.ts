import { describe, expect, it } from 'vitest';
import { PostgresAnalyticsStore } from './owner-analytics.js';

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

describe('analytics currency isolation', () => {
  it('scopes the daily series to the selected primary currency', async () => {
    const pool = new FakePool([
      { rows: [
        { currency: 'usd', gross: '100000', refunds: '0', fees: '3290', net: '96710', events: 6 },
        { currency: 'eur', gross: '50000', refunds: '0', fees: '1470', net: '48530', events: 2 },
      ], rowCount: 2 },
      { rows: [{ day: '2026-11-15', net: '96710' }], rowCount: 1 },
    ]);
    const store = new PostgresAnalyticsStore(pool as never, 'owner_test');
    const summary = await store.revenueSummary(30);
    expect(summary.currency).toBe('USD');
    expect(summary.currencies).toEqual(['USD', 'EUR']);
    expect(summary.byDay).toEqual([{ day: '2026-11-15', netMinor: 96710 }]);
    expect(pool.queries[1].params).toContain('USD');
    expect(pool.queries[1].sql).toContain('currency = $2');
  });

  it('selects the highest-net currency as primary', async () => {
    const pool = new FakePool([
      { rows: [
        { currency: 'usd', gross: '1000', refunds: '0', fees: '30', net: '970', events: 1 },
        { currency: 'eur', gross: '9000', refunds: '0', fees: '270', net: '8730', events: 1 },
      ], rowCount: 2 },
      { rows: [], rowCount: 0 },
    ]);
    const store = new PostgresAnalyticsStore(pool as never, 'owner_test');
    const summary = await store.revenueSummary(30);
    expect(summary.currency).toBe('EUR');
    expect(summary.currencies).toEqual(['EUR', 'USD']);
  });

  it('isolates pipeline stages per currency instead of summing across currencies', async () => {
    const pool = new FakePool([
      { rows: [
        { stage: 'new', currency: 'usd', count: 2, value: '20000' },
        { stage: 'won', currency: 'usd', count: 1, value: '90000' },
        { stage: 'new', currency: 'eur', count: 1, value: '5000' },
        { stage: 'won', currency: 'eur', count: 3, value: '300000' },
      ], rowCount: 4 },
    ]);
    const store = new PostgresAnalyticsStore(pool as never, 'owner_test');
    const pipeline = await store.pipeline();
    expect(pipeline.currency).toBe('EUR');
    expect(pipeline.currencies).toEqual(['EUR', 'USD']);
    expect(pipeline.stages.find(s => s.stage === 'won')?.valueMinor).toBe(300000);
    expect(pipeline.stages.find(s => s.stage === 'new')?.valueMinor).toBe(5000);
    expect(pipeline.stages.some(s => s.stage === 'won' && s.valueMinor === 90000)).toBe(false);
  });

  it('rejects malformed monetary aggregates instead of reporting zero', async () => {
    const pool = new FakePool([
      { rows: [{ currency: 'usd', gross: 'not-a-number', refunds: '0', fees: '0', net: '0', events: 1 }], rowCount: 1 },
    ]);
    const store = new PostgresAnalyticsStore(pool as never, 'owner_test');
    await expect(store.revenueSummary(30)).rejects.toThrow('analytics_unavailable');
  });

  it('rejects oversized pipeline aggregates and invalid currency codes', async () => {
    const oversized = new FakePool([{ rows: [{ stage: 'won', currency: 'usd', count: 1, value: '99999999999999999999' }], rowCount: 1 }]);
    await expect(new PostgresAnalyticsStore(oversized as never, 'owner_test').pipeline()).rejects.toThrow('analytics_unavailable');
    const badCurrency = new FakePool([{ rows: [{ stage: 'won', currency: 'dollars', count: 1, value: '100' }], rowCount: 1 }]);
    await expect(new PostgresAnalyticsStore(badCurrency as never, 'owner_test').pipeline()).rejects.toThrow('analytics_unavailable');
  });

  it('returns an explicit empty summary without inventing currency totals', async () => {
    const pool = new FakePool([{ rows: [], rowCount: 0 }]);
    const store = new PostgresAnalyticsStore(pool as never, 'owner_test');
    const summary = await store.revenueSummary(30);
    expect(summary.eventCount).toBe(0);
    expect(summary.byDay).toEqual([]);
    expect(summary.currencies).toEqual([]);
  });
});
