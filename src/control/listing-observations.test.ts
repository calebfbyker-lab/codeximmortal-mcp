import { afterEach, describe, expect, it, vi } from 'vitest';
import { scryptSync } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import * as files from '../load-tools.js';
import { createOwnerControlApp } from './owner-app.js';
import { localDistributionInventory } from './distribution-inventory.js';
import { listingObservationPanel, parseListingObservations, recordedListingEvidence } from './listing-observations.js';

const now = Date.parse('2026-11-15T22:00:00.000Z');
const base = { channel: 'glama', sourceUrl: 'https://directory.example.test/listing', observedAt: '2026-11-15T20:00:00.000Z', method: 'test_page_extract', listingPresence: 'observed', checkOutcome: 'succeeded', reportedStatus: 'Healthy', independentRuntimeVerification: 'not_performed' };
const encode = (observations: unknown[], schema = 'distribution-observations-v2') => JSON.stringify({ schema, observations });
afterEach(() => vi.restoreAllMocks());

describe('bounded recorded listing evidence', () => {
  it('reads multiple channels without conflating configuration, presence, health, endpoint tests or analytics', () => {
    const r = parseListingObservations(encode([base, { ...base, channel: 'task_board', sourceUrl: 'https://tasks.example.test/listing' }]), ['product-a'], now);
    expect(r.observations).toHaveLength(2);
    expect(r.observations[0].locallyConfigured).toBe(true);
    expect(r.observations[1].locallyConfigured).toBe(false);
    expect(r.observations[0].platformReported).toMatchObject({ status: 'Healthy', independentlyVerified: false });
    expect(r.observations[0].independentEndpointTest.result).toBe('not_performed');
    expect(r.observations[0].analytics.availability).toBe('unknown');
    expect(r.productChannels.every(p => p.mappingStatus === 'unknown')).toBe(true);
  });
  it('preserves a failed check as unknown presence, not removal', () => {
    const r = parseListingObservations(encode([{ ...base, checkOutcome: 'failed', listingPresence: 'unknown', reportedStatus: 'unknown' }]), [], now);
    expect(r.observations[0]).toMatchObject({ checkOutcome: 'failed', listingPresence: 'unknown' });
    expect(() => parseListingObservations(encode([{ ...base, checkOutcome: 'failed' }]), [], now)).toThrow();
  });
  it('marks stale observations and stale endpoint evidence independently', () => {
    const r = parseListingObservations(encode([{ ...base, observedAt: '2026-11-01T00:00:00.000Z' }, { ...base, channel: 'other', independentEndpointTest: { result: 'passed', testedAt: '2026-11-01T00:00:00.000Z', evidenceRef: 'docs/endpoint-test.json' } }]), [], now);
    expect(r.observations[0].freshness).toBe('stale');
    expect(r.observations[1].freshness).toBe('within_age_limit');
    expect(r.observations[1].independentEndpointTest.freshness).toBe('stale');
  });
  it('retains legacy date precision without inventing an exact observation time', () => {
    const { observedAt: _unused, ...legacy } = base;
    const r = parseListingObservations(encode([{ ...legacy, observedOn: '2026-11-15' }], 'distribution-observations-v1'), [], now);
    expect(r.observations[0].timestampPrecision).toBe('day');
    expect(() => parseListingObservations(encode([{ ...legacy, observedOn: '2026-02-30' }]), [], now)).toThrow();
  });
  it('rejects duplicate observations and duplicate product mappings', () => {
    expect(() => parseListingObservations(encode([base, base]), [], now)).toThrow();
    const m = { productId: 'product-a', evidenceRef: 'docs/evidence.json' };
    expect(() => parseListingObservations(encode([{ ...base, productMappings: [m, m] }]), ['product-a'], now)).toThrow();
  });
  it('flags unknown product IDs and only maps explicitly evidenced known products', () => {
    const r = parseListingObservations(encode([{ ...base, productMappings: [{ productId: 'product-a', evidenceRef: 'docs/catalog-evidence.json' }, { productId: 'unrecognized', evidenceRef: 'docs/other.json' }] }]), ['product-a', 'product-b'], now);
    expect(r.observations[0].productMappings[1].catalogMatch).toBe('unknown_product');
    expect(r.productChannels.find(p => p.productId === 'product-a' && p.channel === 'glama')).toMatchObject({ mappingStatus: 'recorded', evidence: [{ observedAt: base.observedAt, evidenceRef: 'docs/catalog-evidence.json' }] });
    expect(r.productChannels.filter(p => p.productId === 'product-b').every(p => p.mappingStatus === 'unknown')).toBe(true);
    expect(listingObservationPanel({ status: 'available', data: r })).toContain('Unknown product mappings');
  });
  it('requires evidence for endpoint and analytics claims', () => {
    expect(() => parseListingObservations(encode([{ ...base, independentEndpointTest: { result: 'passed' } }]), [], now)).toThrow();
    expect(() => parseListingObservations(encode([{ ...base, analyticsAvailability: 'available' }]), [], now)).toThrow();
    const r = parseListingObservations(encode([{ ...base, analyticsAvailability: 'not_connected', analyticsEvidenceRef: 'docs/adapter-check.json' }]), [], now);
    expect(r.observations[0].analytics.availability).toBe('not_connected');
  });
  it('bounds input, validates dates and keeps sensitive URLs out of output', () => {
    for (const value of ['{', 'x'.repeat(65537), encode(Array.from({ length: 101 }, () => base)), encode([{ ...base, sourceUrl: 'https://user:secret@example.test/listing' }]), encode([{ ...base, sourceUrl: 'https://example.test/listing?token=secret' }]), encode([{ ...base, observedAt: '2026-11-16T00:00:00.000Z' }]), encode([{ ...base, evidenceRef: 'docs/../secret' }])]) {
      expect(() => parseListingObservations(value, [], now)).toThrow();
    }
    expect(() => parseListingObservations(encode([]), ['same', 'same'], now)).toThrow();
    expect(() => parseListingObservations(encode([]), [], now, 0)).toThrow();
  });
  it('escapes untrusted platform labels in the panel', () => {
    const data = parseListingObservations(encode([{ ...base, reportedStatus: '<script>alert(1)</script>' }]), [], now);
    const html = listingObservationPanel({ status: 'available', data });
    expect(html).not.toContain('<script>'); expect(html).toContain('&lt;script&gt;');
  });
  it('preserves local metadata if recorded evidence is unavailable', () => {
    const original = files.findProjectFile;
    vi.spyOn(files, 'findProjectFile').mockImplementation(path => path === 'docs/distribution-observations.json' ? '{' : original(path));
    const r = localDistributionInventory();
    expect(r.validation).toBe('passed_project_checks');
    expect(r.listingEvidence.status).toBe('unavailable');
    expect(listingObservationPanel(r.listingEvidence)).toContain('unavailable');
  });
  it('loads existing recorded evidence without promoting local publication checks', () => {
    const r = recordedListingEvidence(now);
    expect(r.status).toBe('available');
    const local = localDistributionInventory();
    expect(local.channels.every(c => c.publication === 'not_checked')).toBe(true);
    expect(local.endpointReadiness).toBe('not_checked');
    if (r.status === 'available') expect(r.data.productChannels.every(p => p.mappingStatus === 'unknown')).toBe(true);
  });
  it('exposes recorded evidence through the existing owner-authenticated API only', async () => {
    const origin = 'https://owner.example.test', saltHex = '12'.repeat(16), password = 'synthetic-listing-password';
    const app = createOwnerControlApp({ origin, owner: 'owner', saltHex, revision: 'a'.repeat(40), hashHex: scryptSync(password, Buffer.from(saltHex, 'hex'), 64).toString('hex') });
    const listener = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => listener.once('listening', resolve));
    const endpoint = 'http://127.0.0.1:' + (listener.address() as AddressInfo).port;
    try {
      expect((await fetch(endpoint + '/api/distribution')).status).toBe(401);
      const login = await fetch(endpoint + '/login', { method: 'POST', redirect: 'manual', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ owner: 'owner', password }) });
      expect(login.status).toBe(303);
      const cookie = login.headers.get('set-cookie')?.split(';')[0];
      expect(cookie).toBeTruthy();
      const response = await fetch(endpoint + '/api/distribution', { headers: { Cookie: cookie! } });
      expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
      const data = await response.json() as { scope: string; listingEvidence: { status: string; data: { scope: string; productChannels: unknown[] } } };
      expect(data.scope).toBe('local_project_checks');
      expect(data.listingEvidence.status).toBe('available');
      expect(data.listingEvidence.data.scope).toBe('recorded_evidence_not_live');
      expect(data.listingEvidence.data.productChannels.length).toBeGreaterThan(0);
    } finally { listener.closeAllConnections(); await new Promise<void>(resolve => listener.close(() => resolve())); }
  });
});
