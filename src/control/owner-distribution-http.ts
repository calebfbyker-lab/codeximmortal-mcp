import type { Express, Request } from 'express';
import { commercePage, escapeHtml as esc } from './commerce-ui.js';
import { localDistributionInventory } from './distribution-inventory.js';
import type { ListingEvidenceRead } from './listing-observations.js';

interface DistributionFilters { product: string; channel: string; mapping: 'all' | 'recorded' | 'unknown' }
export function distributionFilters(query: Record<string, unknown>): DistributionFilters {
  if (Object.keys(query).some(k => !['product', 'channel', 'mapping'].includes(k))) throw new Error('invalid_distribution_filter');
  const read = (key: string) => {
    const v = query[key] ?? '';
    if (typeof v !== 'string' || v.length > 128 || (v !== '' && !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(v))) throw new Error('invalid_distribution_filter');
    return v;
  };
  const mapping = read('mapping') || 'all';
  if (mapping !== 'all' && mapping !== 'recorded' && mapping !== 'unknown') throw new Error('invalid_distribution_filter');
  return { product: read('product'), channel: read('channel'), mapping };
}
const entry = (label: string, value: unknown) => '<dt>' + esc(label) + '</dt><dd>' + esc(value ?? 'Unknown') + '</dd>';
const panel = (title: string, body: string) => '<section class="panel"><div class="panel-head"><h2>' + esc(title) + '</h2></div><div class="panel-body">' + body + '</div></section>';
export function distributionWorkspace(evidence: ListingEvidenceRead, filters: DistributionFilters = { product: '', channel: '', mapping: 'all' }) {
  if (evidence.status === 'unavailable') return '<section class="flash" role="alert"><h2>Recorded evidence unavailable</h2><p>The evidence file or catalog could not be validated. This is not zero listings or zero demand.</p><a href="/distribution">Retry local read</a></section>';
  const d = evidence.data;
  const products = [...new Set(d.productChannels.map(r => r.productId))];
  const channels = [...new Set([...d.configuredChannels, ...d.observations.map(r => r.channel)])];
  const stats = [
    ['Catalog products', products.length], ['Locally tracked channels', d.configuredChannels.length],
    ['Recorded observations', d.observations.length], ['Stale observations', d.observations.filter(r => r.freshness === 'stale').length],
    ['Failed recorded checks', d.observations.filter(r => r.checkOutcome === 'failed').length]
  ].map(([label, value]) => '<div class="stat"><div class="stat-label">' + esc(label) + '</div><div class="stat-value">' + esc(value) + '</div></div>').join('');
  const select = (name: string, label: string, values: string[], selected: string) => '<label class="field">' + label + '<select name="' + name + '">' + values.map(v => '<option value="' + esc(v) + '"' + (v === selected ? ' selected' : '') + '>' + esc(v || 'All') + '</option>').join('') + '</select></label>';
  const withSelected = (values: string[], selected: string) => [...new Set(['', ...values, ...(selected ? [selected] : [])])];
  const form = '<form method="get" action="/distribution" class="prospect-form">' + select('product', 'Product', withSelected(products, filters.product), filters.product) + select('channel', 'Channel', withSelected(channels, filters.channel), filters.channel) + select('mapping', 'Product mapping', ['all','recorded','unknown'], filters.mapping) + '<div class="toolbar"><button class="btn btn--primary">Apply filters</button><a class="btn" href="/distribution">Clear filters</a></div></form>';
  const records = d.observations.filter(r => !filters.channel || r.channel === filters.channel);
  const observationRows = records.map(r => {
    const details = '<details><summary>Inspect evidence</summary><div class="panel-body"><dl>' +
      entry('Source', r.sourceUrl) + entry('Evidence reference', r.evidenceRef) + entry('Observed at', r.observedAt) + entry('Timestamp precision', r.timestampPrecision) + entry('Evidence age', r.freshness) + entry('Method', r.method) + entry('Locally tracked', r.locallyConfigured ? 'Yes; not proof of publication' : 'No') + entry('Platform-reported ownership', r.platformReported.ownership) + entry('Platform last tested', r.platformReported.lastTested) + entry('Endpoint tested at', r.independentEndpointTest.testedAt) + entry('Endpoint test evidence', r.independentEndpointTest.evidenceRef) + entry('Endpoint evidence age', r.independentEndpointTest.freshness) + entry('Analytics evidence', r.analytics.evidenceRef) + entry('Limitations', r.limitations) + '</dl></div></details>';
    return '<tr><th scope="row">' + esc(r.channel) + '</th><td>' + esc(r.listingPresence) + '<p class="hint">Check: ' + esc(r.checkOutcome) + '</p></td><td>' + esc(r.platformReported.status) + '<p class="hint">Platform reported, not independently verified</p></td><td>' + esc(r.independentEndpointTest.result) + '</td><td>' + esc(r.analytics.availability) + '</td><td>' + details + '</td></tr>';
  }).join('');
  const mappings = d.productChannels.filter(r => (!filters.product || r.productId === filters.product) && (!filters.channel || r.channel === filters.channel) && (filters.mapping === 'all' || r.mappingStatus === filters.mapping));
  const mappingRows = mappings.map(r => '<tr><th scope="row">' + esc(r.productId) + '</th><td>' + esc(r.channel) + '</td><td>' + esc(r.mappingStatus) + '</td><td>' + (r.evidence.length ? r.evidence.map(e => '<details><summary>Inspect mapping evidence</summary><div class="panel-body"><dl>' + entry('Evidence reference', e.evidenceRef) + entry('Source', e.sourceUrl) + entry('Observed at', e.observedAt) + entry('Timestamp precision', e.timestampPrecision) + entry('Evidence age', e.freshness) + '</dl></div></details>').join('') : 'No product-specific evidence. Publication remains unknown.') + '</td></tr>').join('');
  const unknown = d.observations.flatMap(r => r.productMappings.filter(m => m.catalogMatch === 'unknown_product').map(m => r.channel + ': ' + m.productId));
  return '<p class="scope-note">Recorded evidence only. Refresh rereads local files; it does not query directories or test endpoints. Date-only legacy observations use midnight UTC for age calculation, not an asserted collection time. Evaluated ' + esc(d.evaluatedAt) + '; age limit ' + esc(d.maxAgeMs / 86400000) + ' days.</p>' +
    '<div class="stat-grid">' + stats + '</div>' + panel('Filter evidence', form + '<p class="hint">Product and mapping filters apply to the product/channel table. Channel filters apply to both tables. Summary counts cover the complete recorded dataset.</p>') +
    (unknown.length ? '<p class="flash" role="alert">Unknown catalog product IDs in recorded evidence: ' + unknown.map(esc).join(', ') + '</p>' : '') +
    '<section class="panel"><div class="panel-head"><h2>Channel observations</h2></div><div class="table-wrap"><table><caption>' + records.length + ' of ' + d.observations.length + ' recorded observations</caption><thead><tr>' + ['Channel','Listing presence','Reported health','Independent endpoint test','Analytics availability','Evidence'].map(v => '<th scope="col">' + v + '</th>').join('') + '</tr></thead><tbody>' + (observationRows || '<tr><td colspan="6">No recorded observations match. This does not establish listing absence.</td></tr>') + '</tbody></table></div></section>' +
    '<section class="panel"><div class="panel-head"><h2>Product/channel mappings</h2></div><div class="table-wrap"><table><caption>' + mappings.length + ' of ' + d.productChannels.length + ' product/channel rows</caption><thead><tr><th scope="col">Product</th><th scope="col">Channel</th><th scope="col">Recorded mapping</th><th scope="col">Evidence</th></tr></thead><tbody>' + (mappingRows || '<tr><td colspan="4">No product/channel rows match these filters.</td></tr>') + '</tbody></table></div></section>' +
    panel('Customer and external-agent interest', '<p>Interest metrics are not available in this evidence source. Listing presence, tool count and platform health are not buyer interest.</p><p>Impressions, catalog requests, inquiries, quotes, verified purchases and repeat buyers require their own event sources and attribution.</p><a class="btn" href="/?view=pipeline">Review recorded opportunities</a> <a class="btn" href="/orders">Inspect orders</a>');
}
export function registerOwnerDistribution(app: Express, current: (req: Request) => unknown, read: typeof localDistributionInventory = localDistributionInventory) {
  const page = (content: string) => commercePage('Distribution & demand', 'distribution', content, { refreshHref: '/distribution' });
  app.get('/distribution', (req, res) => {
    if (!current(req)) { res.redirect(303, '/login'); return; }
    let filters: DistributionFilters;
    try { filters = distributionFilters(req.query as Record<string, unknown>); }
    catch { res.status(400).type('html').send(page('<p class="flash" role="alert">Invalid distribution filters.</p><a href="/distribution">Clear filters</a>')); return; }
    try {
      const inventory = read();
      const local = '<details><summary>Local manifest checks</summary><div class="panel-body"><dl>' + entry('Server', inventory.serverName) + entry('Version', inventory.version) + entry('Project checks', inventory.validation) + entry('Configured endpoints', inventory.endpoints.join(', ') || 'Unavailable') + entry('Offline publication checks', 'Not checked') + entry('Endpoint readiness', inventory.endpointReadiness) + entry('Official schema validation', inventory.officialSchemaValidation) + entry('Server manifest SHA-256', inventory.manifestHashes.server) + entry('Glama manifest SHA-256', inventory.manifestHashes.glama) + entry('Issues', inventory.issues.join(', ') || 'None found by project checks') + '</dl><a href="/api/distribution">View owner inventory JSON</a></div></details>';
      res.status(inventory.listingEvidence.status === 'available' ? 200 : 503).type('html').send(page(distributionWorkspace(inventory.listingEvidence, filters) + local));
    } catch { res.status(503).type('html').send(page('<p class="flash" role="alert">Local distribution metadata unavailable. This is not zero listings.</p>')); }
  });
}
