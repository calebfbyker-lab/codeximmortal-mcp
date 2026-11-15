import { describe, expect, it } from 'vitest';
import { loadCatalog, getOffer, listOffers } from './catalog.js';
import { findProjectFile, loadTools } from './load-tools.js';
import { recordedListingObservation, listingObservationPanel } from './control/listing-observations.js';
const catalog = loadCatalog();
const guide = findProjectFile('docs/buyer-guide.md');
const registry = JSON.parse(findProjectFile('server.json'));
const amounts: Record<string,number> = {
  'federation-consensus':44900, 'bitcoin-wealth-engine':39900, 'sovereign-memory-graph':34900,
  'omniseal-defense':39900, 'revenue-studio':29900, 'agentic-orchestration':34900,
  'operations-lab':24900, 'mcp-sdk':24900, 'ai-council-orchestration':19900,
  'deployment-blueprint':14900, 'starter-kit':4900, 'web-to-json-50':1000
};
describe('buyer documentation and existing discovery contracts', () => {
  it('mirrors all existing catalog IDs and one-time prices without changing the offer set', () => {
    expect(catalog.offers).toHaveLength(12);
    expect(new Set(catalog.offers.map(o => o.offer_id)).size).toBe(12);
    for (const o of catalog.offers) {
      expect(o.pricing.amount_minor).toBe(amounts[o.product_id]); expect(o.pricing.currency).toBe('USD');
      expect(o.pricing.basis).toBe('one-time'); expect(guide).toContain('`' + o.product_id + '`');
      expect(guide).toContain('$' + (o.pricing.amount_minor / 100).toFixed(2));
      expect(new URL(o.checkout_url as string).hostname).toBe('codeximmortal.com');
    }
  });
  it('keeps read-only examples aligned with tools and source handler outputs', () => {
    const names = loadTools().map(t => t.name);
    expect(names).toContain('codex_catalog_list'); expect(names).toContain('codex_catalog_get_product');
    expect(guide).toContain('"name":"codex_catalog_list"'); expect(guide).toContain('"name":"codex_catalog_get_product"');
    expect(listOffers('all').count).toBe(12);
    const product = getOffer('offer-core-agentic-modules-starter-kit');
    expect(product.product_id).toBe('starter-kit'); expect(product.pricing.amount_minor).toBe(4900);
    expect(guide).toContain(product.offer_id);
  });
  it('matches registry remote/repository references in buyer guidance while documenting unresolved legacy drift', () => {
    expect(guide).toContain(registry.remotes[0].url);
    expect(registry.repository.url).toBe('https://github.com/calebfbyker-lab/codeximmortal-mcp');
    expect(guide).toContain('known metadata drift');
    expect(guide).toContain('mcp-manifest.json');
  });
  it('retains the Web-to-JSON and standalone execution boundary', () => {
    const offer = getOffer('web-to-json-50');
    expect(offer.checkout).toMatchObject({ machine_purchase:false, automatic_replenishment:false });
    expect(offer.delivery).toMatchObject({ platform:'base44', render_execution:'not_connected', mcp_execution:'not_connected' });
    expect(guide).toContain('Render/MCP execution is not connected');
    expect(guide).toContain('planned/unpublished');
  });
  it('labels the recorded Glama observation as third-party historical runtime evidence', () => {
    const r = recordedListingObservation();
    expect(r.channel).toBe('glama'); expect(r.independentRuntimeVerification).toBe('not_performed');
    expect(r.reportedLastTested).toContain('2026-11-10');
    expect(listingObservationPanel()).toContain('Third-party page evidence, not a live check.');
  });
});
