import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

export class AnalyticsError extends Error {
  constructor() { super('analytics_unavailable'); this.name = 'AnalyticsError'; }
}

export type RevenueKind = 'charge' | 'refund' | 'fee' | 'other';
export type LeadStage = 'new' | 'qualified' | 'engaged' | 'won' | 'lost';
export interface RevenueEvent {
  eventId: string; kind: RevenueKind; occurredAt: Date;
  grossMinor: number; netMinor: number; currency: string; description: string;
}
export interface RevenueSummary {
  currency: string; grossMinor: number; refundMinor: number; feeMinor: number;
  netMinor: number; eventCount: number;
  byDay: Array<{ day: string; netMinor: number }>;
  /** Distinct currencies present in the reporting window, highest-net currency first. */
  currencies?: string[];
}
export interface LeadRow {
  id: string; source: string; name: string; stage: LeadStage;
  valueMinor: number; currency: string; notes: string;
  createdAt: Date; updatedAt: Date;
}
export interface PipelineSummary {
  stages: Array<{ stage: LeadStage; count: number; valueMinor: number }>;
  leadCount: number; wonValueMinor: number; conversionPercent: number | null;
  /** Currency the reported stage values are denominated in. */
  currency?: string;
  /** Distinct lead currencies present, highest won-value currency first. */
  currencies?: string[];
}
export interface AnalyticsStore {
  revenueSummary(days: number): Promise<RevenueSummary>;
  pipeline(): Promise<PipelineSummary>;
  upsertRevenueEvents(events: RevenueEvent[]): Promise<number>;
  addLead(input: { source: string; name: string; valueMinor?: number; currency?: string; notes?: string }): Promise<LeadRow>;
}

const LEAD_STAGES: LeadStage[] = ['new', 'qualified', 'engaged', 'won', 'lost'];
// pg returns bigint aggregates as strings. Monetary aggregates must be exact
// integers; anything else is a data-quality failure, never a silent zero.
const strictInt = (value: unknown): number => {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'string' && /^-?[0-9]{1,15}$/.test(value)) return Number(value);
  throw new AnalyticsError();
};
const currencyCode = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[A-Za-z]{3}$/.test(value)) throw new AnalyticsError();
  return value.toUpperCase();
};

/**
 * Read-mostly analytics over the owner-local database cache. Revenue data is
 * synchronized from Stripe by owner-stripe-sync.ts; nothing here connects to
 * any financial system directly, and every query is parameterized.
 * Aggregations are currency-isolated: totals, the daily series and pipeline
 * values never sum different currencies, and malformed monetary values fail
 * closed instead of being reported as zero.
 */
export class PostgresAnalyticsStore implements AnalyticsStore {
  constructor(private readonly pool: Pick<Pool, 'query'>, private readonly schema = 'owner_control') {}

  async ensureSchema(): Promise<void> {
    const sql = readFileSync(new URL('../../migrations/005_owner_analytics.sql', import.meta.url), 'utf8').replaceAll('owner_control', this.schema);
    await this.pool.query(sql).catch(() => { throw new AnalyticsError(); });
  }

  private table(name: string): string {
    return '"' + this.schema + '".' + name;
  }

  async revenueSummary(days: number): Promise<RevenueSummary> {
    const window = Number.isSafeInteger(days) && days >= 1 && days <= 365 ? days : 30;
    const totals = await this.pool.query(
      'SELECT currency, COALESCE(SUM(gross_minor) FILTER (WHERE kind = $2), 0)::bigint AS gross, ' +
      'COALESCE(SUM(gross_minor) FILTER (WHERE kind = $3), 0)::bigint AS refunds, ' +
      'COALESCE(SUM(net_minor) FILTER (WHERE kind = $4), 0)::bigint AS fees, ' +
      'COALESCE(SUM(net_minor), 0)::bigint AS net, COUNT(*)::int AS events ' +
      'FROM ' + this.table('owner_revenue_events') + ' WHERE occurred_at >= now() - ($1::int * interval ' + "'1 day'" + ') ' +
      'GROUP BY currency',
      [window, 'charge', 'refund', 'fee'],
    ).catch(() => { throw new AnalyticsError(); });
    const byCurrency = (totals.rows as Array<Record<string, unknown>>).map(row => ({
      currency: currencyCode(row.currency),
      grossMinor: strictInt(row.gross), refundMinor: strictInt(row.refunds),
      feeMinor: strictInt(row.fees), netMinor: strictInt(row.net), eventCount: strictInt(row.events),
    }));
    byCurrency.sort((a, b) => b.netMinor - a.netMinor || (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0));
    const primary = byCurrency[0];
    if (!primary) {
      return { currency: 'USD', grossMinor: 0, refundMinor: 0, feeMinor: 0, netMinor: 0, eventCount: 0, byDay: [], currencies: [] };
    }
    const byDay = await this.pool.query(
      'SELECT to_char(date_trunc(' + "'day'" + ', occurred_at), ' + "'YYYY-MM-DD'" + ') AS day, COALESCE(SUM(net_minor), 0)::bigint AS net ' +
      'FROM ' + this.table('owner_revenue_events') + ' WHERE occurred_at >= now() - ($1::int * interval ' + "'1 day'" + ') AND currency = $2 GROUP BY 1 ORDER BY 1',
      [window, primary.currency],
    ).catch(() => { throw new AnalyticsError(); });
    return {
      currency: primary.currency,
      grossMinor: primary.grossMinor, refundMinor: primary.refundMinor,
      feeMinor: primary.feeMinor, netMinor: primary.netMinor, eventCount: primary.eventCount,
      byDay: byDay.rows.map((r: Record<string, unknown>) => ({ day: String(r.day), netMinor: strictInt(r.net) })),
      currencies: byCurrency.map(row => row.currency),
    };
  }

  async pipeline(): Promise<PipelineSummary> {
    const result = await this.pool.query(
      'SELECT stage::text AS stage, currency, COUNT(*)::int AS count, COALESCE(SUM(value_minor), 0)::bigint AS value FROM ' + this.table('owner_leads') + ' GROUP BY stage, currency',
    ).catch(() => { throw new AnalyticsError(); });
    const byCurrency = new Map<string, Map<string, { count: number; valueMinor: number }>>();
    for (const raw of result.rows) {
      const row = raw as Record<string, unknown>;
      const currency = currencyCode(row.currency);
      const stage = String(row.stage);
      const entry = { count: strictInt(row.count), valueMinor: strictInt(row.value) };
      let stages = byCurrency.get(currency);
      if (!stages) { stages = new Map(); byCurrency.set(currency, stages); }
      const existing = stages.get(stage);
      stages.set(stage, existing ? { count: existing.count + entry.count, valueMinor: existing.valueMinor + entry.valueMinor } : entry);
    }
    const currencies = [...byCurrency.entries()]
      .sort((a, b) => (b[1].get('won')?.valueMinor ?? 0) - (a[1].get('won')?.valueMinor ?? 0) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([currency]) => currency);
    const primaryCurrency = currencies[0];
    if (!primaryCurrency) {
      return { stages: LEAD_STAGES.map(stage => ({ stage, count: 0, valueMinor: 0 })), leadCount: 0, wonValueMinor: 0, conversionPercent: null, currency: 'USD', currencies: [] };
    }
    const stages = byCurrency.get(primaryCurrency)!;
    const stageRows = LEAD_STAGES.map(stage => ({ stage, count: stages.get(stage)?.count ?? 0, valueMinor: stages.get(stage)?.valueMinor ?? 0 }));
    let leadCount = 0;
    for (const entry of stages.values()) leadCount += entry.count;
    const won = stages.get('won');
    return {
      stages: stageRows, leadCount,
      wonValueMinor: won?.valueMinor ?? 0,
      conversionPercent: leadCount > 0 ? Math.round((won?.count ?? 0) / leadCount * 1000) / 10 : null,
      currency: primaryCurrency, currencies,
    };
  }

  async upsertRevenueEvents(events: RevenueEvent[]): Promise<number> {
    let inserted = 0;
    for (const event of events) {
      if (typeof event.eventId !== 'string' || event.eventId.length < 1 || event.eventId.length > 128
        || !Number.isSafeInteger(event.grossMinor) || !Number.isSafeInteger(event.netMinor)
        || !(event.occurredAt instanceof Date) || Number.isNaN(event.occurredAt.getTime())
        || typeof event.currency !== 'string' || event.currency.length !== 3) {
        throw new AnalyticsError();
      }
      const result = await this.pool.query(
        'INSERT INTO ' + this.table('owner_revenue_events') + ' (source, event_id, kind, occurred_at, gross_minor, net_minor, currency, description) ' +
        'VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (source, event_id) DO NOTHING RETURNING event_id',
        ['stripe', event.eventId, event.kind, event.occurredAt.toISOString(), event.grossMinor, event.netMinor,
          event.currency.toUpperCase(), String(event.description ?? '').slice(0, 200)],
      ).catch(() => { throw new AnalyticsError(); });
      inserted += result.rowCount ?? 0;
    }
    return inserted;
  }

  async addLead(input: { source: string; name: string; valueMinor?: number; currency?: string; notes?: string }): Promise<LeadRow> {
    if (typeof input.source !== 'string' || input.source.length < 1 || input.source.length > 64
      || typeof input.name !== 'string' || input.name.trim().length < 1 || input.name.length > 200
      || (input.valueMinor !== undefined && (!Number.isSafeInteger(input.valueMinor) || input.valueMinor < 0 || input.valueMinor > 1e12))) {
      throw new AnalyticsError();
    }
    const result = await this.pool.query(
      'INSERT INTO ' + this.table('owner_leads') + ' (id, source, name, value_minor, currency, notes) VALUES ($1, $2, $3, $4, $5, $6) ' +
      'RETURNING id, source, name, stage, value_minor, currency, notes, created_at, updated_at',
      [randomUUID(), input.source, input.name.trim().slice(0, 200), input.valueMinor ?? 0,
        (input.currency ?? 'USD').toUpperCase().slice(0, 3), String(input.notes ?? '').slice(0, 2000)],
    ).catch(() => { throw new AnalyticsError(); });
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new AnalyticsError();
    return {
      id: String(row.id), source: String(row.source), name: String(row.name),
      stage: String(row.stage) as LeadStage, valueMinor: strictInt(row.value_minor),
      currency: String(row.currency), notes: String(row.notes ?? ''),
      createdAt: new Date(String(row.created_at)), updatedAt: new Date(String(row.updated_at)),
    };
  }
}
