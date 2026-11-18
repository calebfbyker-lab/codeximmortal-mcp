import { request as httpsRequest } from 'node:https';
import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';
import { PostgresAnalyticsStore, type AnalyticsStore, type RevenueEvent, type RevenueKind } from './owner-analytics.js';

export type StripeFetch = (path: string, key: string, signal: AbortSignal) => Promise<{ status: number; body: string }>;

/** Bounded, pinned-host read of the Stripe API: TLS 1.2 floor, certificate
 *  verification, 15s timeout, 5MB body cap, loopback-free by construction
 *  (api.stripe.com only). The key is read from the local environment and never
 *  logged or transmitted anywhere else. */
function defaultStripeFetch(path: string, key: string, signal: AbortSignal): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    if (!path.startsWith('/v1/') || path.length > 512) { reject(new Error('stripe_sync_failed')); return; }
    const req = httpsRequest({
      host: 'api.stripe.com', port: '443', path, method: 'GET',
      minVersion: 'TLSv1.2', rejectUnauthorized: true, signal, timeout: 15000,
      headers: { authorization: 'Bearer ' + key, accept: 'application/json' },
    }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        body += chunk;
        if (body.length > 5242880) res.destroy(new Error('stripe_response_too_large'));
      });
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('timeout', () => req.destroy(new Error('stripe_timeout')));
    req.on('error', reject);
    req.end();
  });
}

const mapKind = (type: unknown): RevenueKind =>
  type === 'charge' ? 'charge'
    : type === 'refund' || type === 'adjustment' ? 'refund'
    : type === 'stripe_fee' || type === 'network_fee' ? 'fee'
    : 'other';

export function parseBalanceTransactions(body: string): { events: RevenueEvent[]; hasMore: boolean; lastId: string | null } {
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { throw new Error('stripe_sync_failed'); }
  const record = parsed as { object?: unknown; data?: unknown; has_more?: unknown };
  if (record?.object !== 'list' || !Array.isArray(record.data)) throw new Error('stripe_sync_failed');
  const events: RevenueEvent[] = [];
  for (const raw of record.data) {
    const t = raw as Record<string, unknown>;
    const id = typeof t.id === 'string' ? t.id : '';
    const created = Number(t.created);
    if (!id || !Number.isSafeInteger(created) || created <= 0) throw new Error('stripe_sync_failed');
    events.push({
      eventId: id,
      kind: mapKind(t.type),
      occurredAt: new Date(created * 1000),
      grossMinor: typeof t.amount === 'number' && Number.isSafeInteger(t.amount) ? t.amount : 0,
      netMinor: typeof t.net === 'number' && Number.isSafeInteger(t.net) ? t.net : 0,
      currency: typeof t.currency === 'string' ? t.currency.toUpperCase() : 'USD',
      description: typeof t.description === 'string' ? t.description.slice(0, 200) : '',
    });
  }
  return { events, hasMore: record.has_more === true, lastId: events.length ? events[events.length - 1].eventId : null };
}

/** Pulls up to maxPages of balance transactions and caches them in the
 *  owner-local database. Read-only against Stripe; the restricted read key
 *  cannot move money. */
export async function syncStripeRevenue(options: {
  key: string; store: AnalyticsStore; maxPages?: number; fetcher?: StripeFetch; signal?: AbortSignal;
}): Promise<{ inserted: number; fetched: number }> {
  if (typeof options.key !== 'string' || !/^(sk|rk)_(test_)?[A-Za-z0-9_]{10,}$/.test(options.key)) throw new Error('stripe_sync_failed');
  const fetcher = options.fetcher ?? defaultStripeFetch;
  const maxPages = Number.isSafeInteger(options.maxPages) && options.maxPages !== undefined ? Math.min(Math.max(options.maxPages, 1), 20) : 5;
  const signal = options.signal ?? new AbortController().signal;
  let path = '/v1/balance_transactions?limit=100';
  let inserted = 0, fetched = 0;
  for (let page = 0; page < maxPages; page++) {
    const response = await fetcher(path, options.key, signal);
    if (response.status !== 200) throw new Error('stripe_sync_failed');
    const parsed = parseBalanceTransactions(response.body);
    fetched += parsed.events.length;
    if (parsed.events.length > 0) inserted += await options.store.upsertRevenueEvents(parsed.events);
    if (!parsed.hasMore || !parsed.lastId) break;
    path = '/v1/balance_transactions?limit=100&starting_after=' + encodeURIComponent(parsed.lastId);
  }
  return { inserted, fetched };
}

async function main() {
  const key = process.env.CODEX_STRIPE_READ_KEY ?? '';
  const ack = process.env.CODEX_STRIPE_READ_ACK === 'local-read-only-key';
  const url = process.env.CODEX_OWNER_TASK_DATABASE_URL ?? '';
  if (!key || !ack || !url) {
    console.error('Requires CODEX_STRIPE_READ_KEY (restricted read-only), CODEX_STRIPE_READ_ACK=local-read-only-key and CODEX_OWNER_TASK_DATABASE_URL, set locally, never in chat.');
    process.exitCode = 1;
    return;
  }
  const pool = new Pool({ connectionString: url, max: 2 });
  try {
    const store = new PostgresAnalyticsStore(pool);
    await store.ensureSchema();
    const result = await syncStripeRevenue({ key, store });
    console.log('Stripe sync complete: fetched ' + result.fetched + ' balance transactions, inserted ' + result.inserted + ' new revenue events.');
  } catch {
    console.error('Stripe sync failed. Check the key, network and owner database. No secrets logged.');
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  void main();
}
