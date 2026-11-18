import express from 'express';
import { scryptSync } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { createOwnerControlApp } from './owner-app.js';
import { distributionFilters, distributionWorkspace, registerOwnerDistribution } from './owner-distribution-http.js';
import { distributionInventory } from './distribution-inventory.js';
import { parseListingObservations } from './listing-observations.js';

const now = Date.parse('2026-11-15T23:00:00.000Z');
const evidence = { status: 'available' as const, data: parseListingObservations(JSON.stringify({ schema: 'distribution-observations-v2', observations: [{ channel: 'glama', sourceUrl: 'https://listing.example.test/item', observedAt: '2026-11-01T00:00:00.000Z', method: 'fixture', listingPresence: 'observed', reportedStatus: '<unsafe>', productMappings: [{ productId: 'alpha', evidenceRef: 'docs/alpha.json' }] }] }), ['alpha', 'beta'], now) };
async function serve(app: ReturnType<typeof express>, run: (base: string) => Promise<void>) {
  const listener = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => listener.once('listening', resolve));
  try { await run('http://127.0.0.1:' + (listener.address() as AddressInfo).port); }
  finally { listener.closeAllConnections(); await new Promise<void>(resolve => listener.close(() => resolve())); }
}
describe('owner distribution workspace', () => {
  it('validates bounded scalar filters and rejects unknown or repeated parameters', () => {
    expect(distributionFilters({})).toEqual({ product: '', channel: '', mapping: 'all' });
    expect(distributionFilters({ product: 'alpha', channel: 'glama', mapping: 'unknown' }).mapping).toBe('unknown');
    for (const q of [{ product: ['alpha','beta'] }, { channel: '<script>' }, { mapping: 'published' }, { token: 'secret' }, { product: 'a'.repeat(129) }]) expect(() => distributionFilters(q)).toThrow('invalid_distribution_filter');
  });
  it('shows recorded counts, stale evidence and unavailable interest without inventing buyers', () => {
    const html = distributionWorkspace(evidence);
    expect(html).toContain('Stale observations'); expect(html).toContain('Customer and external-agent interest');
    expect(html).toContain('not available in this evidence source');
    expect(html).toContain('does not query directories or test endpoints');
    expect(html).not.toContain('<unsafe>'); expect(html).toContain('&lt;unsafe&gt;');
    expect(html).toContain('docs/alpha.json');
  });
  it('filters product/channel mappings while labeling the separate observation scope', () => {
    const html = distributionWorkspace(evidence, { product: 'beta', channel: 'glama', mapping: 'unknown' });
    expect(html).toContain('1 of 4 product/channel rows');
    expect(html).toContain('1 of 1 recorded observations');
    expect(html).toContain('No product-specific evidence');
    expect(html).toContain('Product and mapping filters apply to the product/channel table');
    expect(html).not.toContain('Inspect mapping evidence');
  });
  it('distinguishes no matches from evidence failure', () => {
    expect(distributionWorkspace(evidence, { product: 'absent', channel: '', mapping: 'all' })).toContain('No product/channel rows match');
    const html = distributionWorkspace({ status: 'unavailable', error: 'listing_evidence_unavailable' });
    expect(html).toContain('not zero listings or zero demand');
  });
  it('uses actual owner login, denies unauthenticated access and renders the active navigation item', async () => {
    const saltHex = '12'.repeat(16), password = 'synthetic-distribution-workspace-password', origin = 'https://owner.example.test';
    const app = createOwnerControlApp({ owner: 'owner', origin, saltHex, revision: 'a'.repeat(40), hashHex: scryptSync(password, Buffer.from(saltHex, 'hex'), 64).toString('hex') });
    await serve(app, async base => {
      const denied = await fetch(base + '/distribution', { redirect: 'manual' });
      expect(denied.status).toBe(303); expect(denied.headers.get('location')).toBe('/login');
      const login = await fetch(base + '/login', { method: 'POST', redirect: 'manual', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ owner: 'owner', password }) });
      expect(login.status).toBe(303);
      const cookie = login.headers.get('set-cookie')!.split(';')[0];
      const response = await fetch(base + '/distribution', { headers: { Cookie: cookie } });
      expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
      const html = await response.text();
      expect(html).toContain('<title>Distribution &amp; demand | CodexImmortal</title>');
      expect(html).toContain('href="/distribution" aria-current="page"');
      expect(html.match(/aria-current="page"/g)).toHaveLength(1);
      const invalid = await fetch(base + '/distribution?product=alpha&product=beta', { headers: { Cookie: cookie } });
      expect(invalid.status).toBe(400);
      expect((await fetch(base + '/distribution', { method: 'POST', headers: { Cookie: cookie } })).status).toBe(404);
    });
  });
  it('returns a readable 503 and preserves local metadata when recorded evidence fails', async () => {
    const app = express();
    const local = distributionInventory(JSON.stringify({}), JSON.stringify({}));
    registerOwnerDistribution(app, () => true, () => ({ ...local, listingEvidence: { status: 'unavailable', error: 'listing_evidence_unavailable' } }));
    await serve(app, async base => {
      const response = await fetch(base + '/distribution');
      expect(response.status).toBe(503);
      const html = await response.text(); expect(html).toContain('Recorded evidence unavailable'); expect(html).toContain('Local manifest checks');
    });
  });
  it('does not read inventory before authentication and reports local metadata failure', async () => {
    let reads = 0;
    const app = express();
    registerOwnerDistribution(app, req => req.get('x-test-owner') === 'yes', () => { reads++; throw new Error('unavailable'); });
    await serve(app, async base => {
      expect((await fetch(base + '/distribution', { redirect: 'manual' })).status).toBe(303); expect(reads).toBe(0);
      const response = await fetch(base + '/distribution', { headers: { 'x-test-owner': 'yes' } });
      expect(response.status).toBe(503); expect(await response.text()).toContain('Local distribution metadata unavailable');
    });
  });
});
