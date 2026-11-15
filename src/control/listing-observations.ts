import { findProjectFile } from '../load-tools.js';
import { escapeHtml as esc } from './commerce-ui.js';

const configuredChannels = ['official_mcp_registry', 'glama'] as const;
const fail = (): never => { throw new Error('invalid_listing_observation'); };
const obj = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return fail();
  return v as Record<string, unknown>;
};
function text(v: unknown, max = 1000): string {
  if (typeof v !== 'string' || !v.length || v.length > max || /[\u0000-\u001f\u007f]/.test(v)) return fail();
  return v;
}
function identifier(v: unknown): string {
  const s = text(v, 128);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(s)) return fail();
  return s;
}
function choice<T extends string>(v: unknown, allowed: readonly T[]): T {
  if (!allowed.includes(v as T)) return fail();
  return v as T;
}
function url(v: unknown): string {
  const s = text(v, 1024);
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) return fail();
    return u.href;
  } catch { return fail(); }
}
function reference(v: unknown): string {
  const s = text(v, 1024);
  if (s.startsWith('https://')) return url(s);
  if (!/^docs\/[a-zA-Z0-9_./#-]+$/.test(s) || s.includes('..')) return fail();
  return s;
}
function timestamp(v: unknown): string {
  const s = text(v, 24);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s)) return fail();
  const n = Date.parse(s);
  if (!Number.isFinite(n) || new Date(n).toISOString() !== s) return fail();
  return s;
}
function productIdsFromCatalog(catalogText: string) {
  if (Buffer.byteLength(catalogText) > 131072) return fail();
  const value = obj(JSON.parse(catalogText));
  if (!Array.isArray(value.offers) || value.offers.length > 64) return fail();
  const ids = value.offers.map(v => identifier(obj(v).product_id));
  if (new Set(ids).size !== ids.length) return fail();
  return ids;
}

/** Offline evidence parser. No URLs are fetched and no reported state is independently verified. */
export function parseListingObservations(observationText: string, productIds: readonly string[], now = Date.now(), maxAgeMs = 7 * 86400000) {
  if (Buffer.byteLength(observationText) > 65536 || productIds.length > 64 || !Number.isFinite(now) || !Number.isFinite(maxAgeMs) || maxAgeMs <= 0) return fail();
  const known = new Set(productIds.map(identifier));
  if (known.size !== productIds.length) return fail();
  const document = obj(JSON.parse(observationText));
  choice(document.schema, ['distribution-observations-v1', 'distribution-observations-v2']);
  if (!Array.isArray(document.observations) || document.observations.length > 100) return fail();
  const seen = new Set<string>();
  const observations = document.observations.map(raw => {
    const r = obj(raw);
    const channel = identifier(r.channel);
    const sourceUrl = url(r.sourceUrl);
    const method = text(r.method, 128);
    let observedAt: string;
    let timestampPrecision: 'day' | 'millisecond' = 'millisecond';
    if (r.observedAt !== undefined) observedAt = timestamp(r.observedAt);
    else {
      const day = text(r.observedOn, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return fail();
      observedAt = timestamp(day + 'T00:00:00.000Z');
      timestampPrecision = 'day';
    }
    if (Date.parse(observedAt) > now) return fail();
    const key = JSON.stringify([channel, sourceUrl, observedAt, method]);
    if (seen.has(key)) return fail();
    seen.add(key);
    const evidenceRef = r.evidenceRef === undefined ? sourceUrl : reference(r.evidenceRef);
    const listingPresence = choice(r.listingPresence ?? 'unknown', ['observed', 'not_observed', 'unknown']);
    const checkOutcome = choice(r.checkOutcome ?? (listingPresence === 'observed' ? 'succeeded' : 'not_performed'), ['succeeded', 'failed', 'not_performed']);
    if (listingPresence !== 'unknown' && checkOutcome !== 'succeeded') return fail();
    const reportedStatus = r.reportedStatus === undefined ? 'unknown' : text(r.reportedStatus);
    const reportedOwnership = r.reportedOwnership === undefined ? 'unknown' : text(r.reportedOwnership);
    const reportedLastTested = r.reportedLastTested === undefined ? 'unknown' : text(r.reportedLastTested);
    const endpoint = r.independentEndpointTest === undefined ? {} : obj(r.independentEndpointTest);
    const result = choice(endpoint.result ?? r.independentRuntimeVerification ?? 'not_performed', ['not_performed', 'passed', 'failed', 'unavailable']);
    const testedAt = result === 'not_performed' ? null : timestamp(endpoint.testedAt);
    const endpointEvidenceRef = result === 'not_performed' ? null : reference(endpoint.evidenceRef);
    if (testedAt && Date.parse(testedAt) > now) return fail();
    const analytics = choice(r.analyticsAvailability ?? 'unknown', ['unknown', 'not_available', 'available', 'not_connected']);
    const analyticsEvidenceRef = analytics === 'unknown' ? null : reference(r.analyticsEvidenceRef);
    const mappings = r.productMappings ?? [];
    if (!Array.isArray(mappings) || mappings.length > 64) return fail();
    const mappedIds = new Set<string>();
    const productMappings = mappings.map(rawMapping => {
      const m = obj(rawMapping);
      const productId = identifier(m.productId);
      if (mappedIds.has(productId) || listingPresence !== 'observed') return fail();
      mappedIds.add(productId);
      return { productId, evidenceRef: reference(m.evidenceRef), catalogMatch: known.has(productId) ? 'known' as const : 'unknown_product' as const };
    });
    return { channel, locallyConfigured: configuredChannels.some(c => c === channel), sourceUrl, observedAt, timestampPrecision, method, evidenceRef,
      checkOutcome, listingPresence,
      platformReported: { status: reportedStatus, ownership: reportedOwnership, lastTested: reportedLastTested, independentlyVerified: false as const },
      freshness: now - Date.parse(observedAt) >= maxAgeMs ? 'stale' as const : 'within_age_limit' as const,
      independentEndpointTest: { result, testedAt, evidenceRef: endpointEvidenceRef, freshness: testedAt === null ? 'unknown' as const : now - Date.parse(testedAt) >= maxAgeMs ? 'stale' as const : 'within_age_limit' as const },
      analytics: { availability: analytics, evidenceRef: analyticsEvidenceRef }, productMappings,
      limitations: r.limitations === undefined ? 'Recorded evidence only; not a live check.' : text(r.limitations) };
  });
  const channels = [...new Set<string>([...configuredChannels, ...observations.map(o => o.channel)])];
  if (channels.length > 16) return fail();
  const productChannels = productIds.flatMap(productId => channels.map(channel => {
    const evidence = observations.flatMap(o => o.channel === channel ? o.productMappings.filter(m => m.productId === productId && m.catalogMatch === 'known').map(m => ({ evidenceRef: m.evidenceRef, sourceUrl: o.sourceUrl, observedAt: o.observedAt, timestampPrecision: o.timestampPrecision, freshness: o.freshness })) : []);
    return { productId, channel, locallyConfigured: configuredChannels.some(c => c === channel), mappingStatus: evidence.length ? 'recorded' as const : 'unknown' as const, evidence };
  }));
  return { scope: 'recorded_evidence_not_live' as const, evaluatedAt: new Date(now).toISOString(), maxAgeMs, configuredChannels: [...configuredChannels], observations, productChannels };
}
export type ListingEvidence = ReturnType<typeof parseListingObservations>;
export type ListingEvidenceRead = { status: 'available'; data: ListingEvidence } | { status: 'unavailable'; error: 'listing_evidence_unavailable' };
export function recordedListingEvidence(now = Date.now()): ListingEvidenceRead {
  try { return { status: 'available', data: parseListingObservations(findProjectFile('docs/distribution-observations.json'), productIdsFromCatalog(findProjectFile('catalog.json')), now) }; }
  catch { return { status: 'unavailable', error: 'listing_evidence_unavailable' }; }
}
export function listingObservationPanel(evidence: ListingEvidenceRead = recordedListingEvidence()) {
  if (evidence.status === 'unavailable') return '<p class="flash" role="alert">Recorded listing evidence unavailable. No live registry check was attempted.</p>';
  const data = evidence.data;
  const observations = data.observations.map(r => '<tr>' + [r.channel, r.locallyConfigured ? 'Yes' : 'No', r.checkOutcome, r.listingPresence, r.platformReported.status + ' (platform reported; last tested: ' + r.platformReported.lastTested + ')', r.independentEndpointTest.result + ' / ' + r.independentEndpointTest.freshness + ' / ' + (r.independentEndpointTest.testedAt ?? 'No test timestamp') + ' / ' + (r.independentEndpointTest.evidenceRef ?? 'No test evidence'), r.analytics.availability + ' / ' + (r.analytics.evidenceRef ?? 'No analytics evidence'), r.observedAt + ' (' + r.timestampPrecision + ' precision)', r.freshness, r.evidenceRef, r.sourceUrl, r.method, r.platformReported.ownership, r.limitations].map(v => '<td>' + esc(v) + '</td>').join('') + '</tr>').join('');
  const rows = data.productChannels.map(r => '<tr><td>' + esc(r.productId) + '</td><td>' + esc(r.channel) + '</td><td>' + esc(r.mappingStatus) + '</td><td>' + (r.evidence.map(e => esc(e.evidenceRef + ' / ' + e.observedAt + ' / ' + e.freshness)).join('<br>') || 'No product-specific evidence') + '</td></tr>').join('');
  const unknown = data.observations.flatMap(o => o.productMappings.filter(m => m.catalogMatch === 'unknown_product').map(m => o.channel + ': ' + m.productId));
  return '<section class="panel"><div class="panel-head"><h2>Recorded listing observations</h2></div><div class="panel-body"><p class="hint">Recorded evidence, not a live check. Locally configured means tracked by this project, not published. Server presence does not establish product publication. Age limit: ' + esc(String(data.maxAgeMs / 86400000)) + ' days; evaluated ' + esc(data.evaluatedAt) + '. Date-only legacy observations use midnight UTC for conservative age calculation, not an asserted collection time.</p>' +
    (unknown.length ? '<p role="alert">Unknown product mappings: ' + unknown.map(esc).join(', ') + '</p>' : '') +
    '<div class="table-wrap"><table><caption>Channel observations</caption><thead><tr>' + ['Channel','Locally configured','Check outcome','Listing presence','Platform-reported health','Independent endpoint test / age / time / evidence','Analytics availability / evidence','Observation time','Evidence age','Evidence reference','Source','Method','Reported ownership','Limitations'].map(v => '<th scope="col">' + v + '</th>').join('') + '</tr></thead><tbody>' + (observations || '<tr><td colspan="14">No recorded observations. Publication is unknown.</td></tr>') + '</tbody></table></div>' +
    '<div class="table-wrap"><table><caption>Product/channel evidence</caption><thead><tr><th scope="col">Product</th><th scope="col">Channel</th><th scope="col">Mapping</th><th scope="col">Evidence / observation time / age</th></tr></thead><tbody>' + (rows || '<tr><td colspan="4">No catalog products recorded.</td></tr>') + '</tbody></table></div></div></section>';
}
