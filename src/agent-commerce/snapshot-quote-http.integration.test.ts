import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { loadTools } from '../load-tools.js';
import { createSnapshotQuoteSandboxApp } from './snapshot-quote-tool.js';
import { ApiError, type Dependencies, type Principal } from './api.js';
const clients: Client[] = [], servers: Server[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map(c => c.close()));
  await Promise.all(servers.splice(0).map(s => new Promise<void>((resolve,reject) => {
    s.closeAllConnections(); s.close(e => e ? reject(e) : resolve());
  })));
});
async function fixture(token: string | undefined = 'buyer-a', enabled = true) {
  const quote = vi.fn(async (p: Principal) => ({ id: 'synthetic-quote', buyerId: p.buyerId,
    service: 'pricing_snapshot', amountMinor: 100, currency: 'USD', expiresAt: '2030-01-01T00:00:00.000Z' }));
  const submit = vi.fn(async () => ({ id: 'must-not-submit' }));
  const deps: Dependencies = { enabled, authenticate: vi.fn(async t => ({ buyerId: t, clientId: 'test-client',
    scopes: t === 'no-scope' ? [] : ['commerce:quote','services:execute','jobs:read','results:read'] })),
    consume: vi.fn(async () => ({ allowed: true, retryAfter: 0 })), backend: {
      quote, submit, job: async () => null, result: async () => null
    } };
  const dispatch = vi.fn(async () => ({ publicCatalog: true }));
  const app = createSnapshotQuoteSandboxApp({ tools: loadTools(), commerce: deps, dispatch,
    catalog: { catalog_version: 'synthetic', offers: [] }, agentCardJson: '{}',
    storefrontRouter: (_req,_res,next) => next(), pricingRoute: '/fixture-disabled-pricing' });
  const s = app.listen(0,'127.0.0.1'); servers.push(s);
  await new Promise<void>((resolve,reject) => { s.once('listening',resolve); s.once('error',reject); });
  const client = new Client({ name: 'snapshot-quote-test', version: '1.0.0' }); clients.push(client);
  const url = new URL('/mcp', `http://127.0.0.1:${(s.address() as AddressInfo).port}`);
  await client.connect(new StreamableHTTPClientTransport(url, token ? { requestInit: { headers: { Authorization: 'Bearer ' + token } } } : {}));
  return { client, quote, submit, deps, dispatch };
}
function value(result: Awaited<ReturnType<Client['callTool']>>) {
  const content = result.content as Array<{type:string;text?:string}>;
  const text = content.find(c => c.type === 'text')?.text;
  if (!text) throw new Error('missing_test_content'); return JSON.parse(text);
}
const args = { service: 'pricing_snapshot', input: { sourceId: 'source-1' } };
describe('snapshot quote through real SDK and existing HTTP app', () => {
  it('discovers the real schema and quotes without submitting a job', async () => {
    const f = await fixture(); const tools = (await f.client.listTools()).tools;
    expect(tools).toHaveLength(loadTools().length + 1);
    const tool = tools.find(t => t.name === 'codex_service_quote');
    expect(tool?.inputSchema.additionalProperties).toBe(false);
    const result = await f.client.callTool({ name: 'codex_service_quote', arguments: args });
    expect(result.isError).not.toBe(true); expect(value(result)).toMatchObject({ id: 'synthetic-quote', amountMinor: 100 });
    expect(f.quote).toHaveBeenCalledWith(expect.objectContaining({ buyerId: 'buyer-a' }), 'pricing_snapshot', { sourceId: 'source-1' });
    expect(f.submit).not.toHaveBeenCalled(); expect(f.dispatch).not.toHaveBeenCalled();
  });
  it('rejects missing bearer and insufficient scope', async () => {
    for (const token of [undefined, 'no-scope']) {
      // Explicit undefined must not select the fixture default.
      const f = await fixture(token === undefined ? '' : token);
      const result = await f.client.callTool({ name: 'codex_service_quote', arguments: args });
      expect(result.isError).toBe(true); expect(f.quote).not.toHaveBeenCalled();
    }
  });
  it('keeps commerce disabled while leaving the public catalog callable', async () => {
    const f = await fixture('buyer-a', false);
    const result = await f.client.callTool({ name: 'codex_service_quote', arguments: args });
    expect(value(result).error.code).toBe('service_disabled'); expect(f.deps.authenticate).not.toHaveBeenCalled();
    const catalog = await f.client.callTool({ name: 'codex_catalog_list', arguments: {} });
    expect(catalog.isError).not.toBe(true);
  });
  it('enforces snapshot-only service selection beyond advertised JSON Schema', async () => {
    const f = await fixture();
    const result = await f.client.callTool({ name: 'codex_service_quote', arguments: {
      service: 'pricing_compare', input: { beforeId: 'a', afterId: 'b' }
    } });
    expect(result.isError).toBe(true); expect(f.quote).not.toHaveBeenCalled();
  });
  it('preserves private-resource and unpriced-service failures without gateway fallback', async () => {
    const f = await fixture();
    for (const [status,code] of [[404,'not_found'],[503,'service_unpriced']] as const) {
      f.quote.mockRejectedValueOnce(new ApiError(status, code));
      const result = await f.client.callTool({ name: 'codex_service_quote', arguments: args });
      expect(result.isError).toBe(true); expect(value(result).error.code).toBe(code);
    }
    expect(f.dispatch).not.toHaveBeenCalled();
  });
  it('does not modify the production manifest tool list', () => {
    expect(loadTools().some(t => t.name === 'codex_service_quote')).toBe(false);
  });
});
