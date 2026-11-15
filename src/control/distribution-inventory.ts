import { listingObservationPanel } from './listing-observations.js';
import { createHash } from 'node:crypto';
import { findProjectFile } from '../load-tools.js';
import { escapeHtml as esc } from './commerce-ui.js';
const object = (v: unknown): Record<string,unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string,unknown> : {};
const bounded = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
const sha = (v: string) => createHash('sha256').update(v).digest('hex');

/** Project-specific offline checks, NOT full official Registry schema validation. */
export function distributionInventory(serverText: string, glamaText: string) {
  if (Buffer.byteLength(serverText) > 65536 || Buffer.byteLength(glamaText) > 65536) throw new Error('distribution_inventory_unavailable');
  let server: Record<string,unknown>, glama: Record<string,unknown>;
  try { server = object(JSON.parse(serverText)); glama = object(JSON.parse(glamaText)); }
  catch { throw new Error('distribution_inventory_unavailable'); }
  const issues: string[] = [];
  if (server.$schema !== 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json') issues.push('review_server_schema_reference');
  if (!bounded(server.name, 200) || !/^io\.github\.[a-zA-Z0-9-]+\/[a-zA-Z0-9_.-]+$/.test(String(server.name))) issues.push('invalid_project_namespace');
  if (!bounded(server.version, 128)) issues.push('invalid_version');
  if (!bounded(server.description, 100)) issues.push('invalid_description');
  const repo = object(server.repository);
  let repoOwner = '';
  try {
    const u = new URL(String(repo.url));
    if (u.protocol !== 'https:' || u.hostname !== 'github.com' || u.username || u.password || u.search || u.hash || repo.source !== 'github') throw new Error();
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length !== 2 || !parts.every(p => /^[a-zA-Z0-9_.-]+$/.test(p))) throw new Error();
    repoOwner = parts[0];
    if (!String(server.name).startsWith('io.github.' + repoOwner + '/')) issues.push('namespace_repository_mismatch');
  } catch { issues.push('invalid_repository_reference'); }
  const endpoints: string[] = [];
  const remotes = Array.isArray(server.remotes) ? server.remotes : [];
  if (remotes.length < 1 || remotes.length > 8) issues.push('invalid_remote_count');
  for (const raw of remotes.slice(0,8)) {
    const r = object(raw);
    try {
      const u = new URL(String(r.url));
      if (r.type !== 'streamable-http' || u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) throw new Error();
      // Show configured destinations as text only. Never fetch caller/file URLs.
      endpoints.push((u.origin + u.pathname).slice(0,512));
    } catch { issues.push('invalid_or_sensitive_remote'); }
  }
  const maintainers = Array.isArray(glama.maintainers) ? glama.maintainers : [];
  if (!maintainers.length || maintainers.length > 20 || maintainers.some(v => typeof v !== 'string' || !/^[a-zA-Z0-9-]{1,39}$/.test(v))) issues.push('invalid_glama_maintainers');
  return {
    scope: 'local_project_checks' as const,
    validation: issues.length ? 'issues_found' as const : 'passed_project_checks' as const,
    issues: [...new Set(issues)],
    serverName: bounded(server.name,200) ? String(server.name) : 'Unavailable',
    version: bounded(server.version,128) ? String(server.version) : 'Unavailable', endpoints,
    manifestHashes: { server: sha(serverText), glama: sha(glamaText) },
    channels: [
      { channel: 'official_mcp_registry', publication: 'not_checked' as const },
      { channel: 'glama', publication: 'not_checked' as const },
    ],
    endpointReadiness: 'not_checked' as const,
    officialSchemaValidation: 'not_performed' as const,
  };
}
export function localDistributionInventory() {
  try { return distributionInventory(findProjectFile('server.json'), findProjectFile('glama.json')); }
  catch { throw new Error('distribution_inventory_unavailable'); }
}
export function distributionPanel() {
  try {
    const r = localDistributionInventory();
    return '<section class="panel"><div class="panel-head"><h2>Distribution inventory</h2></div><div class="panel-body"><p class="hint">Local project checks only. No registry, endpoint or ownership verification was performed. Manifest presence is not publication.</p><dl><dt>Server</dt><dd>' + esc(r.serverName) + '</dd><dt>Version</dt><dd>' + esc(r.version) + '</dd><dt>Project checks</dt><dd>' + esc(r.validation) + '</dd><dt>Configured endpoints</dt><dd>' + esc(r.endpoints.join(', ') || 'Unavailable') + '</dd><dt>Official Registry</dt><dd>Not checked</dd><dt>Glama</dt><dd>Not checked</dd><dt>Endpoint readiness</dt><dd>Not checked</dd></dl>' +
      (r.issues.length ? '<p role="alert">Review: ' + r.issues.map(esc).join(', ') + '</p>' : '') +
      '<details><summary>Manifest fingerprints</summary><div class="panel-body"><p>server.json: <code>' + r.manifestHashes.server + '</code></p><p>glama.json: <code>' + r.manifestHashes.glama + '</code></p></div></details><a href="/api/distribution">View local inventory JSON</a></div></section>' + listingObservationPanel();
  } catch { return '<section class="flash" role="alert"><h2>Distribution inventory unavailable</h2><p>Local metadata could not be read. Orders remain a separate data source.</p></section>'; }
}
