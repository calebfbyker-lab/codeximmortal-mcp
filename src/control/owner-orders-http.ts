import type { Express, Request } from 'express';
import { Pool } from 'pg';
import { PostgresOwnerCommerceOrders } from './owner-commerce-orders.js';

export type OwnerOrdersStore = Pick<PostgresOwnerCommerceOrders, 'list'>;
const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v: unknown) => String(v).replace(/[&<>"']/g, c => entities[c]!);
function page(content: string) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Orders | CodexImmortal</title><link rel="stylesheet" href="/assets/owner.css"></head><body><main class="content"><nav aria-label="Owner navigation"><a href="/">Owner dashboard</a> / <a href="/orders" aria-current="page">Orders</a></nav><div class="page-head"><h1>External-agent orders</h1><p>Read-only standalone commerce records. Reservations are not proof of payment; receipt references are not reconciliation.</p></div>' + content + '</main></body></html>';
}
function render(data: Awaited<ReturnType<OwnerOrdersStore['list']>>) {
  const rows = data.orders.map(o => '<tr>' + [o.jobId, o.buyerId, o.clientId, o.service, o.quoteId, o.status,
    o.amountMinor + ' ' + o.currency + ' minor units', o.reservationState ?? 'Unavailable', o.receiptId ?? 'Unavailable',
    o.attribution, o.paymentEvidence, o.reconciliation].map(v => '<td>' + esc(v) + '</td>').join('') + '</tr>').join('');
  return page('<p class="hint">Up to 50 records, ordered by job ID descending, not creation time. No combined-currency total. Source and payment evidence are not inferred.</p><p><a class="btn" href="/orders">Refresh orders</a></p>' +
    (rows ? '<div class="table-wrap"><table><caption>Standalone commerce orders</caption><thead><tr>' +
      ['Job', 'Buyer', 'Client', 'Service', 'Quote', 'Status', 'Amount', 'Reservation', 'Receipt reference', 'Attribution', 'Payment evidence', 'Reconciliation'].map(v => '<th scope="col">' + v + '</th>').join('') +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>' : '<section class="empty"><h2>No orders found</h2><p>The configured commerce store returned no jobs.</p></section>'));
}
export function registerOwnerOrders(app: Express, current: (req: Request) => unknown, store?: OwnerOrdersStore) {
  app.get('/api/orders', async (req, res) => {
    if (!current(req)) { res.status(401).json({ error: 'unauthorized' }); return; }
    if (!store) { res.json({ configured: false, state: 'disabled' }); return; }
    try { res.json({ configured: true, ...await store.list(50) }); }
    catch { res.status(503).json({ error: 'commerce_orders_unavailable' }); }
  });
  app.get('/orders', async (req, res) => {
    if (!current(req)) { res.redirect(303, '/login'); return; }
    if (!store) { res.type('html').send(page('<section class="flash flash--warn"><h2>Orders disabled</h2><p>No commerce read store is configured. This is not zero orders.</p></section>')); return; }
    try { res.type('html').send(render(await store.list(50))); }
    catch { res.status(503).type('html').send(page('<section class="flash" role="alert"><h2>Orders unavailable</h2><p>The commerce store could not be read. This is not zero orders.</p><a href="/orders">Retry</a></section>')); }
  });
}

/** Explicit local-only opt-in. No migrations, grants, or payment connections. */
export function localOwnerOrders(env: NodeJS.ProcessEnv) {
  if (env.CODEX_OWNER_ORDERS_ENABLED !== 'true') return undefined;
  if (env.CODEX_OWNER_ORDERS_ACK !== 'local-read-only-commerce') throw new Error('owner_orders_configuration_required');
  let url: URL;
  try { url = new URL(env.CODEX_OWNER_ORDERS_DATABASE_URL ?? ''); }
  catch { throw new Error('owner_orders_configuration_required'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.search || url.hash) {
    throw new Error('owner_orders_configuration_required');
  }
  const pool = new Pool({ connectionString: url.toString(), max: 2, connectionTimeoutMillis: 5000,
    statement_timeout: 5000, options: '-c default_transaction_read_only=on' });
  return { pool, store: new PostgresOwnerCommerceOrders(pool) };
}
