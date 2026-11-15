import { afterEach, describe, expect, it } from 'vitest';
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createOwnerControlApp } from './owner-app.js';
import { ownerCss } from './owner-console.js';
import { ownerLayoutCss } from './owner-layout.js';
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(s => new Promise<void>((resolve,reject) => {
    s.closeAllConnections(); s.close(e => e ? reject(e) : resolve());
  })));
});
async function start() {
  const app = createOwnerControlApp({ origin: 'https://localhost:8443', owner: 'owner',
    saltHex: 'ab'.repeat(16), hashHex: 'cd'.repeat(64), revision: 'a'.repeat(40) });
  const s = app.listen(0,'127.0.0.1'); servers.push(s);
  await new Promise<void>((resolve,reject) => { s.once('listening',resolve); s.once('error',reject); });
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}
function get(base: string, path: string) {
  return new Promise<{ status: number; body: string; headers: Record<string, unknown> }>((resolve,reject) => {
    const req = request(new URL(path,base), { agent: false }, res => {
      let body = ''; res.setEncoding('utf8'); res.on('data',c => { body += c; });
      res.on('end',() => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
      res.on('error',reject);
    });
    req.setTimeout(5000,() => req.destroy(new Error('layout_test_timeout')));
    req.on('error',reject); req.end();
  });
}
describe('owner light layout HTTP integration', () => {
  it('serves base component rules followed by the layout overrides', async () => {
    const r = await get(await start(),'/assets/owner.css');
    expect(r.status).toBe(200); expect(r.headers['content-type']).toContain('text/css');
    expect(r.body).toBe(ownerCss + '\n' + ownerLayoutCss);
    expect(r.body.indexOf('/* owner-layout-v1 */')).toBeGreaterThan(0);
    expect(r.headers['cache-control']).toBe('no-store');
  });
  it('retains same-origin security policy and existing login form', async () => {
    const base = await start(); const login = await get(base,'/login');
    expect(login.status).toBe(200); expect(login.body).toContain('/assets/owner.css');
    expect(login.body).toContain('action=/login'); expect(login.body).toContain('name=password');
    const csp = String(login.headers['content-security-policy']);
    expect(csp).toContain("style-src 'self'"); expect(csp).not.toContain('unsafe-inline');
    expect((await get(base,'/api/overview')).status).toBe(401);
    expect((await get(base,'/orders')).status).toBe(303);
  });
  it('declares light, responsive and reduced-motion presentation without remote assets', () => {
    expect(ownerLayoutCss).toContain('color-scheme:light');
    expect(ownerLayoutCss).toContain('@media(max-width:900px)');
    expect(ownerLayoutCss).toContain('@media(max-width:480px)');
    expect(ownerLayoutCss).toContain('prefers-reduced-motion');
    expect(ownerLayoutCss).not.toMatch(/@import|url\(/i);
  });
});
