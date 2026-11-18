import { afterEach, describe, expect, it, vi } from 'vitest';
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { scryptSync } from 'node:crypto';
import { createOwnerControlApp, type OwnerConfig } from './owner-app.js';
import { localOwnerOrders, type OwnerOrdersStore } from './owner-orders-http.js';
const password = 'synthetic-owner-password-only';
const origin = 'https://owner.example.test';
const saltHex = '12'.repeat(16);
const config: OwnerConfig = { origin, owner: 'owner', saltHex,
  hashHex: scryptSync(password, Buffer.from(saltHex, 'hex'), 64).toString('hex'), revision: 'a'.repeat(40) };
const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(s => new Promise<void>((resolve, reject) => {
  s.closeAllConnections(); s.close(e => e ? reject(e) : resolve());
}))); });
async function start(store?: OwnerOrdersStore, now: () => number = Date.now) {
  const s = createOwnerControlApp(config, now, undefined, undefined, undefined, undefined, store).listen(0, '127.0.0.1');
  servers.push(s);
  await new Promise<void>((resolve, reject) => { s.once('listening', resolve); s.once('error', reject); });
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}
function http(base: string, path: string, headers: Record<string, string> = {}, body?: string) {
  return new Promise<{ status: number; body: string; cookie: string; cache: unknown }>((resolve, reject) => {
    const req = request(new URL(path, base), { agent: false, method: body === undefined ? 'GET' : 'POST', headers: {
      ...headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) })
    } }, res => { let text = ''; res.setEncoding('utf8'); res.on('data', c => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text,
        cookie: res.headers['set-cookie']?.[0]?.split(';')[0] ?? '', cache: res.headers['cache-control'] }));
      res.on('error', reject);
    });
    req.setTimeout(5000, () => req.destroy(new Error('test_http_timeout')));
    req.on('error', reject); req.end(body);
  });
}
async function login(base: string) {
  return (await http(base, '/login', { Origin: origin }, JSON.stringify({ owner: 'owner', password }))).cookie;
}
const sample = { ordering: 'job_id_desc' as const, orders: [{ jobId: 'job', buyerId: 'buyer', clientId: '<script>bad</script>',
  service: 'pricing_compare', quoteId: 'quote', status: 'queued', amountMinor: '100', currency: 'USD',
  reservationState: 'held', receiptId: null, attribution: 'unknown' as const,
  paymentEvidence: 'not_evaluated' as const, reconciliation: 'not_evaluated' as const }] };
describe('owner orders authenticated routes', () => {
  it('rejects anonymous, buyer bearer and forged owner headers before reading', async () => {
    const list = vi.fn().mockResolvedValue(sample); const base = await start({ list });
    const headerCases: Array<Record<string, string>> = [{}, { Authorization: 'Bearer buyer-token', 'X-Owner': 'owner' }];
    for (const headers of headerCases) {
      expect((await http(base, '/api/orders', headers)).status).toBe(401);
      expect((await http(base, '/orders', headers)).status).toBe(303);
    }
    expect(list).not.toHaveBeenCalled();
  });
  it('shows disabled rather than zero when no store is configured', async () => {
    const base = await start(); const Cookie = await login(base);
    expect(JSON.parse((await http(base, '/api/orders', { Cookie })).body)).toEqual({ configured: false, state: 'disabled' });
    expect((await http(base, '/orders', { Cookie })).body).toContain('Orders disabled');
  });
  it('renders escaped orders and links from dashboard; reads are bounded and noncached', async () => {
    const list = vi.fn().mockResolvedValue(sample); const base = await start({ list }); const Cookie = await login(base);
    const api = await http(base, '/api/orders', { Cookie });
    expect(api.status).toBe(200); expect(api.cache).toBe('no-store');
    expect(JSON.parse(api.body)).toMatchObject({ configured: true, orders: [{ amountMinor: '100', paymentEvidence: 'not_evaluated' }] });
    const page = await http(base, '/orders', { Cookie });
    expect(page.status).toBe(200); expect(page.body).toContain('&lt;script&gt;'); expect(page.body).not.toContain('<script>bad');
    expect(page.body).toContain('<caption>Standalone commerce orders</caption>');
    expect((await http(base, '/', { Cookie })).body).toContain('href="/orders"');
    expect(list).toHaveBeenCalledWith(50);
  });
  it('distinguishes empty from unavailable and sanitizes failures', async () => {
    const list = vi.fn().mockResolvedValue({ ordering: 'job_id_desc', orders: [] });
    const base = await start({ list }); const Cookie = await login(base);
    expect((await http(base, '/orders', { Cookie })).body).toContain('No orders found');
    list.mockRejectedValue(new Error('private-database-secret'));
    const api = await http(base, '/api/orders', { Cookie });
    expect(api.status).toBe(503); expect(api.body).not.toContain('private-database-secret');
    const page = await http(base, '/orders', { Cookie });
    expect(page.status).toBe(503); expect(page.body).toContain('Orders unavailable');
  });
  it('rejects expired and duplicate session cookies', async () => {
    let time = 1000; const list = vi.fn().mockResolvedValue(sample);
    const base = await start({ list }, () => time); const Cookie = await login(base);
    expect((await http(base, '/api/orders', { Cookie: Cookie + '; ' + Cookie })).status).toBe(401);
    time += 900001;
    expect((await http(base, '/api/orders', { Cookie })).status).toBe(401);
    expect(list).not.toHaveBeenCalled();
  });
  it('keeps launcher disabled and rejects nonlocal or unacknowledged configuration', () => {
    expect(localOwnerOrders({})).toBeUndefined();
    expect(() => localOwnerOrders({ CODEX_OWNER_ORDERS_ENABLED: 'true' })).toThrow('owner_orders_configuration_required');
    expect(() => localOwnerOrders({ CODEX_OWNER_ORDERS_ENABLED: 'true', CODEX_OWNER_ORDERS_ACK: 'local-read-only-commerce',
      CODEX_OWNER_ORDERS_DATABASE_URL: 'postgresql://db.example.test/commerce' })).toThrow('owner_orders_configuration_required');
  });
});
