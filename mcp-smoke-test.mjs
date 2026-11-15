import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const manifest = JSON.parse(readFileSync(new URL('./server.json', import.meta.url), 'utf8'));
const catalog = JSON.parse(readFileSync(new URL('./catalog.json', import.meta.url), 'utf8'));
const endpoint = new URL(manifest.remotes?.find(r => r.type === 'streamable-http')?.url);
if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('invalid_smoke_endpoint');
const client = new Client({ name: 'codeximmortal-smoke-test', version: '1.1.0' }, { capabilities: {} });
const transport = new StreamableHTTPClientTransport(endpoint);
const report = { observedAt: new Date().toISOString(), endpoint: endpoint.href,
  deployedCommit: 'unknown', scope: 'read_only_catalog', initialization: 'not_run',
  toolDiscovery: 'not_run', catalogList: 'not_run', productDetail: 'not_run' };
const watchdog = setTimeout(() => { console.error(JSON.stringify({ ...report, error: 'smoke_timeout' })); process.exit(1); }, 180000);
function payload(result) {
  if (result.isError) throw new Error('tool_reported_error');
  const text = result.content?.find(c => c.type === 'text')?.text;
  if (typeof text !== 'string') throw new Error('missing_json_tool_content');
  return JSON.parse(text);
}
try {
  await client.connect(transport, { timeout: 90000 }); report.initialization = 'pass';
  const names = [], seen = new Set(); let cursor;
  for (let page = 0; page < 20; page++) {
    const result = await client.listTools(cursor ? { cursor } : {}, { timeout: 30000 });
    names.push(...result.tools.map(t => t.name)); cursor = result.nextCursor;
    if (!cursor) break;
    if (seen.has(cursor) || page === 19) throw new Error('invalid_tool_pagination');
    seen.add(cursor);
  }
  if (!names.includes('codex_catalog_list') || !names.includes('codex_catalog_get_product')) throw new Error('missing_catalog_tools');
  report.toolDiscovery = 'pass'; report.toolCount = names.length;
  const listed = payload(await client.callTool({ name: 'codex_catalog_list', arguments: { category: 'all' } }, undefined, { timeout: 30000 }));
  if (!Array.isArray(listed.offers) || listed.count !== listed.offers.length || listed.offers.length !== catalog.offers.length || listed.catalog_version !== catalog.catalog_version) throw new Error('remote_catalog_version_or_count_drift');
  for (const expected of catalog.offers) {
    const actual = listed.offers.find(o => o.offer_id === expected.offer_id);
    if (!actual || actual.pricing?.amount_minor !== expected.pricing.amount_minor || actual.pricing?.currency !== expected.pricing.currency || actual.checkout_url !== expected.checkout_url) throw new Error('remote_catalog_commercial_drift');
  }
  report.catalogList = 'pass';
  const expected = catalog.offers.find(o => o.product_id === 'starter-kit');
  if (!expected) throw new Error('missing_local_fixture_offer');
  const product = payload(await client.callTool({ name: 'codex_catalog_get_product', arguments: { offer_id: expected.offer_id } }, undefined, { timeout: 30000 }));
  if (product.offer_id !== expected.offer_id || product.pricing?.amount_minor !== expected.pricing.amount_minor || product.checkout_url !== expected.checkout_url) throw new Error('remote_product_drift');
  report.productDetail = 'pass';
} catch {
  report.error = 'remote_smoke_failed'; process.exitCode = 1;
} finally {
  try { await client.close(); } catch { report.cleanup = 'failed'; process.exitCode = 1; }
  clearTimeout(watchdog);
  console.log(JSON.stringify(report, null, 2));
}
