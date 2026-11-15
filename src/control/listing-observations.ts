import { findProjectFile } from '../load-tools.js';
import { escapeHtml as esc } from './commerce-ui.js';
export function recordedListingObservation() {
  const text = findProjectFile('docs/distribution-observations.json');
  if (Buffer.byteLength(text) > 16384) throw new Error('invalid_listing_observation');
  const value = JSON.parse(text);
  const row = value.observations?.[0];
  if (value.schema !== 'distribution-observations-v1' || !row || row.channel !== 'glama' ||
    row.sourceUrl !== 'https://glama.ai/mcp/connectors/io.github.calebfbyker-lab/codeximmortal' ||
    row.independentRuntimeVerification !== 'not_performed') throw new Error('invalid_listing_observation');
  for (const key of ['observedOn','method','reportedStatus','reportedOwnership','reportedLastTested','limitations']) {
    if (typeof row[key] !== 'string' || row[key].length > 1000) throw new Error('invalid_listing_observation');
  }
  return { channel: 'glama', sourceUrl: row.sourceUrl as string, observedOn: row.observedOn as string,
    reportedStatus: row.reportedStatus as string, reportedOwnership: row.reportedOwnership as string,
    reportedLastTested: row.reportedLastTested as string, limitations: row.limitations as string,
    method: row.method as string, independentRuntimeVerification: 'not_performed' as const };
}
export function listingObservationPanel() {
  try {
    const r = recordedListingObservation();
    return '<section class="panel"><div class="panel-head"><h2>Recorded Glama listing observation</h2></div><div class="panel-body"><p class="hint">Third-party page evidence, not a live check.</p><dl><dt>Page observed on</dt><dd>' + esc(r.observedOn) + '</dd><dt>Source</dt><dd>' + esc(r.sourceUrl) + '</dd><dt>Glama-reported status</dt><dd>' + esc(r.reportedStatus) + '</dd><dt>Glama-reported ownership</dt><dd>' + esc(r.reportedOwnership) + '</dd><dt>Glama last tested</dt><dd>' + esc(r.reportedLastTested) + '</dd><dt>Independent MCP test</dt><dd>Not performed in this observation</dd></dl><p class="hint">' + esc(r.limitations) + '</p></div></section>';
  } catch { return '<p class="flash" role="alert">Recorded listing observation unavailable. No live registry check was attempted.</p>'; }
}
