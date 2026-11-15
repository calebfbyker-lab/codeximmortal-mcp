import { describe, expect, it, vi } from 'vitest';
import { createRequestDispatcher } from './mcp-dispatch.js';
import type { Dependencies } from './api.js';
import { snapshotQuoteTool, withSnapshotQuoteTool } from './snapshot-quote-tool.js';
function fixture() {
  const principal = { buyerId: 'buyer-a', clientId: 'client-a', scopes: ['commerce:quote'] };
  const quote = vi.fn(async () => ({ id: 'quote-test', service: 'pricing_snapshot', amountMinor: 100, currency: 'USD' }));
  const dependencies: Dependencies = { enabled: true, authenticate: vi.fn(async () => principal),
    consume: vi.fn(async () => ({ allowed: true, retryAfter: 0 })), backend: {
      quote, submit: vi.fn(async () => { throw new Error('unexpected_submit'); }),
      job: vi.fn(async () => null), result: vi.fn(async () => null)
    } };
  const fallback = vi.fn(async () => { throw new Error('unexpected_fallback'); });
  const dispatch = createRequestDispatcher(dependencies, ['Authorization','Bearer synthetic-test-token'], fallback);
  return { principal, dependencies, quote, dispatch, fallback };
}
const input = { service: 'pricing_snapshot', input: { sourceId: 'source-1' } };
describe('snapshot quote definition and shared boundary', () => {
  it('defines a non-payment quote with explicit write/non-idempotent hints', () => {
    const t = snapshotQuoteTool(); expect(t.name).toBe('codex_service_quote');
    expect(t.annotations).toMatchObject({ readOnlyHint: false, idempotentHint: false });
    expect(t.inputSchema.additionalProperties).toBe(false);
    expect(withSnapshotQuoteTool([])).toHaveLength(1);
    expect(() => withSnapshotQuoteTool([t])).toThrow('duplicate_service_quote_tool');
  });
  it('passes only the authenticated principal and normalized source', async () => {
    const f = fixture(); await f.dispatch('codex_service_quote', input);
    expect(f.quote).toHaveBeenCalledWith(f.principal, 'pricing_snapshot', { sourceId: 'source-1' });
    expect(f.dependencies.backend.submit).not.toHaveBeenCalled(); expect(f.fallback).not.toHaveBeenCalled();
  });
  it('rejects caller identity, price and URL-source injection', async () => {
    const f = fixture();
    for (const args of [{ ...input, buyerId: 'foreign' }, { ...input, amountMinor: 1 },
      { ...input, input: { sourceId: 'https://private.example/source' } }]) {
      await expect(f.dispatch('codex_service_quote', args)).rejects.toMatchObject({ status: 400 });
    }
    expect(f.quote).not.toHaveBeenCalled();
  });
  it('fails closed while disabled before authentication', async () => {
    const f = fixture(); f.dependencies.enabled = false;
    await expect(f.dispatch('codex_service_quote', input)).rejects.toMatchObject({ status: 503, code: 'service_disabled' });
    expect(f.dependencies.authenticate).not.toHaveBeenCalled();
  });
  it('requires quote scope and enforces quota before backend access', async () => {
    const f = fixture(); f.principal.scopes = [];
    await expect(f.dispatch('codex_service_quote', input)).rejects.toMatchObject({ status: 403 });
    f.principal.scopes = ['commerce:quote']; f.dependencies.consume = async () => ({ allowed: false, retryAfter: 10 });
    await expect(f.dispatch('codex_service_quote', input)).rejects.toMatchObject({ status: 429 });
    expect(f.quote).not.toHaveBeenCalled();
  });
});
