import type { Express, Request } from 'express';
import { Pool } from 'pg';
import { PostgresOwnerCommerceOrders } from './owner-commerce-orders.js';
import { distributionPanel, localDistributionInventory } from './distribution-inventory.js';
import { commerceCss, commercePage, escapeHtml as esc } from './commerce-ui.js';

export type OwnerOrdersStore = Pick<PostgresOwnerCommerceOrders, 'list'>;
function page(content: string) {
  return commercePage('Orders & delivery', 'orders', content + distributionPanel(), {
    description: 'Review delivery state and transaction references. Reservations are not proof of payment.',
    refreshHref: '/orders'
  });
}
function render(data: Awaited<ReturnType<OwnerOrdersStore['list']>>) {
  const rows = data.orders.map(o => {
    const refs = [['Job', o.jobId], ['Quote', o.quoteId], ['Reservation', o.reservationState ?? 'Unavailable'],
      ['Receipt reference', o.receiptId ?? 'Unavailable'], ['Attribution', o.attribution],
      ['Payment evidence', o.paymentEvidence], ['Reconciliation', o.reconciliation]];
    const details = '<details><summary>View references</summary><div class="panel-body"><dl>' + refs.map(([k,v]) => '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>').join('') + '</dl></div></details>';
    return '<tr><td>' + esc(o.service) + '</td><td><code>' + esc(o.buyerId) + '</code></td><td>' + esc(o.clientId) + '</td><td><span class="badge">' + esc(o.status) + '</span></td><td class="num">' + esc(o.amountMinor + ' ' + o.currency) + '<div class="hint">minor units</div></td><td>' + details + '</td></tr>';
  }).join('');
  return page('<p>Read-only standalone commerce records. Reservations are not proof of payment; receipt references are not reconciliation.</p><div class="toolbar"><p class="hint">Up to 50 records, ordered by job ID descending, not creation time. No combined-currency total.</p></div>' +
    (rows ? '<div class="table-wrap"><table><caption>Standalone commerce orders</caption><thead><tr>' +
      ['Service', 'Buyer', 'Client', 'Delivery state', 'Amount', 'Details'].map(v => '<th scope="col">' + v + '</th>').join('') +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>' : '<section class="empty"><h2>No orders found</h2><p>The configured commerce store returned no jobs.</p></section>'));
}
export function registerOwnerOrders(app: Express, current: (req: Request) => unknown, store?: OwnerOrdersStore) {
  app.get('/assets/commerce.css', (_req, res) => { res.type('css').send(commerceCss); });
  app.get('/api/distribution', (req, res) => {
    if (!current(req)) { res.status(401).json({ error: 'unauthorized' }); return; }
    try { res.json(localDistributionInventory()); }
    catch { res.status(503).json({ error: 'distribution_inventory_unavailable' }); }
  });
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
