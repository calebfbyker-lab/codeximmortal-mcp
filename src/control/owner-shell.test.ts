import { scryptSync } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { createOwnerControlApp } from './owner-app.js';
import { normalizeOwnerShell } from './owner-shell.js';

const page = '<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">Owner control<link rel=stylesheet href=/assets/owner.css></head><body><nav class=nav><a href="/">Overview</a><a href="/orders">Orders</a></nav></body></html>';

describe('owner shell normalization', () => {
  it('wraps the stray page title in a title element', () => {
    const html = normalizeOwnerShell(page);
    expect(html).toContain('<title>Owner control | CodexImmortal</title>');
    expect(html).not.toContain('initial-scale=1">Owner control<link');
  });
  it('adds Distribution before Orders exactly once', () => {
    const html = normalizeOwnerShell(page);
    expect(html.match(/href="\/distribution"/g)).toHaveLength(1);
    expect(html.indexOf('/distribution')).toBeLessThan(html.indexOf('/orders'));
    expect(normalizeOwnerShell(html)).toBe(html);
  });
  it('adds Orders when missing and leaves pages without navigation or with titles intact', () => {
    expect(normalizeOwnerShell(page.replace('<a href="/orders">Orders</a>', ''))).toContain('href="/orders"');
    const noNav = '<html><head><title>Existing</title></head><body>No navigation</body></html>';
    expect(normalizeOwnerShell(noNav)).toBe(noNav);
  });
  it('renders a titled authenticated overview with Distribution navigation', async () => {
    const saltHex = '12'.repeat(16), password = 'synthetic-shell-test-password', origin = 'https://owner.example.test';
    const app = createOwnerControlApp({ owner: 'owner', origin, saltHex, revision: 'a'.repeat(40), hashHex: scryptSync(password, Buffer.from(saltHex, 'hex'), 64).toString('hex') });
    const listener = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => listener.once('listening', resolve));
    try {
      const base = 'http://127.0.0.1:' + (listener.address() as AddressInfo).port;
      const login = await fetch(base + '/login', { method: 'POST', redirect: 'manual', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ owner: 'owner', password }) });
      const cookie = login.headers.get('set-cookie')!.split(';')[0];
      const html = await (await fetch(base + '/', { headers: { Cookie: cookie } })).text();
      expect(html).toMatch(/<title>[^<]+ \| CodexImmortal<\/title>/);
      expect(html).toContain('href="/distribution"');
      expect(html).toContain('href="/orders"');
      const loginHtml = await (await fetch(base + '/login')).text();
      expect(loginHtml).toMatch(/<title>[^<]+ \| CodexImmortal<\/title>/);
    } finally { listener.closeAllConnections(); await new Promise<void>(resolve => listener.close(() => resolve())); }
  });
});
