import { describe, expect, it } from 'vitest';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { scryptSync } from 'node:crypto';
import { distributionInventory, localDistributionInventory } from './distribution-inventory.js';
import { createOwnerControlApp } from './owner-app.js';
const server = { $schema: 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json',
  name: 'io.github.example/service', version: '1.0.0', description: 'Synthetic catalog',
  repository: { url: 'https://github.com/example/service', source: 'github' },
  remotes: [{ type: 'streamable-http', url: 'https://service.example.test/mcp' }] };
const glama = JSON.stringify({ maintainers: ['example'] });
function send(base: string, path: string, body?: string, headers: Record<string,string> = {}) {
  return new Promise<{ status: number; text: string; cookie: string; cache: unknown }>((resolve,reject) => {
    const req = request(base + path, { agent: false, method: body === undefined ? 'GET' : 'POST', headers: { ...headers,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }) } }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', c => { text += c; }); res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text, cookie: res.headers['set-cookie']?.[0]?.split(';')[0] ?? '', cache: res.headers['cache-control'] }));
    }); req.setTimeout(5000, () => req.destroy(new Error('test_timeout'))); req.on('error', reject); req.end(body);
  });
}
describe('offline distribution inventory', () => {
  it('checks project metadata without asserting publication or schema certification', () => {
    const r = distributionInventory(JSON.stringify(server), glama);
    expect(r.validation).toBe('passed_project_checks');
    expect(r.channels.every(c => c.publication === 'not_checked')).toBe(true);
    expect(r.officialSchemaValidation).toBe('not_performed'); expect(r.endpointReadiness).toBe('not_checked');
    expect(r.manifestHashes.server).toMatch(/^[a-f0-9]{64}$/);
  });
  it('detects namespace drift and never returns credential-bearing endpoints', () => {
    const r = distributionInventory(JSON.stringify({ ...server, name: 'io.github.other/service', remotes: [{ type: 'streamable-http', url: 'https://user:private-secret@service.example.test/mcp?token=secret' }] }), glama);
    expect(r.issues).toContain('namespace_repository_mismatch'); expect(r.issues).toContain('invalid_or_sensitive_remote');
    expect(JSON.stringify(r)).not.toContain('private-secret'); expect(r.endpoints).toEqual([]);
  });
  it('bounds malformed data and validates the existing repository manifests offline', () => {
    expect(() => distributionInventory('{', glama)).toThrow('distribution_inventory_unavailable');
    expect(() => distributionInventory('x'.repeat(65537), glama)).toThrow('distribution_inventory_unavailable');
    expect(localDistributionInventory().validation).toBe('passed_project_checks');
  });
  it('uses actual owner session guards and renders inventory even when Orders are disabled', async () => {
    const origin = 'https://owner.example.test', password = 'synthetic-distribution-password', saltHex = '12'.repeat(16);
    const app = createOwnerControlApp({ origin, owner: 'owner', saltHex, revision: 'a'.repeat(40),
      hashHex: scryptSync(password, Buffer.from(saltHex, 'hex'), 64).toString('hex') });
    const listener = app.listen(0,'127.0.0.1');
    await new Promise<void>(resolve => listener.once('listening', resolve));
    const base = 'http://127.0.0.1:' + (listener.address() as AddressInfo).port;
    try {
      expect((await send(base,'/api/distribution')).status).toBe(401);
      expect((await send(base,'/api/distribution',undefined,{ Authorization:'Bearer buyer', 'X-Owner':'owner' })).status).toBe(401);
      const login = await send(base,'/login',JSON.stringify({ owner:'owner',password }),{ Origin:origin });
      expect(login.status).toBe(303);
      const result = await send(base,'/api/distribution',undefined,{ Cookie:login.cookie });
      expect(result.status).toBe(200); expect(result.cache).toBe('no-store');
      expect(JSON.parse(result.text).channels).toHaveLength(2);
      const page = await send(base,'/orders',undefined,{ Cookie:login.cookie });
      expect(page.text).toContain('Orders disabled'); expect(page.text).toContain('Distribution inventory');
      expect(page.text).toContain('Not checked');
    } finally { listener.closeAllConnections(); await new Promise<void>(resolve => listener.close(() => resolve())); }
  });
});
