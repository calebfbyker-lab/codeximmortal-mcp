import { expect, it } from 'vitest';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { scryptSync } from 'node:crypto';
import { createOwnerControlApp } from './owner-app.js';

// Header and native form-encoding contract; not a real-browser automation test.
it('preserves form-compatible referrer policy and strict origin/CSRF checks', async () => {
  const origin = 'https://localhost:8443';
  const password = 'synthetic-form-password-only';
  const salt = Buffer.alloc(16, 7);
  const server = createOwnerControlApp({ origin, owner: 'owner', saltHex: salt.toString('hex'),
    hashHex: scryptSync(password, salt, 64).toString('hex'), revision: '280c5d5da8b21c5595cfecca1af2d1892e2ae41c' }).listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    function send(path: string, body?: string, suppliedOrigin?: string, cookie?: string) {
      return new Promise<{ status: number; text: string; policy: string; cookie: string }>((resolve, reject) => {
        const req = request(new URL(path, base), { agent: false, method: body === undefined ? 'GET' : 'POST',
          headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }),
            ...(suppliedOrigin === undefined ? {} : { Origin: suppliedOrigin }), ...(cookie ? { Cookie: cookie } : {}) } }, res => {
          let text = ''; res.setEncoding('utf8'); res.on('data', chunk => { text += chunk; });
          res.on('error', reject); res.on('end', () => resolve({ status: res.statusCode ?? 0, text,
            policy: String(res.headers['referrer-policy'] ?? ''), cookie: res.headers['set-cookie']?.[0]?.split(';')[0] ?? '' }));
        });
        req.setTimeout(5000, () => req.destroy(new Error('fixture_timeout')));
        req.on('error', reject); req.end(body);
      });
    }
    expect((await send('/login')).policy).toBe('same-origin');
    const credentials = new URLSearchParams({ owner: 'owner', password }).toString();
    for (const denied of [undefined, 'null', 'https://foreign.example.test', 'https://127.0.0.1:8443']) {
      expect((await send('/login', credentials, denied)).status).toBe(403);
    }
    const login = await send('/login', credentials, origin);
    expect(login.status).toBe(303); expect(login.cookie).not.toBe('');
    const page = await send('/', undefined, undefined, login.cookie);
    expect(page.status).toBe(200); expect(page.policy).toBe('same-origin');
    const csrf = /name=csrf value="([^"]+)"/.exec(page.text)?.[1]; expect(csrf).toBeTruthy();
    const logout = new URLSearchParams({ csrf: csrf! }).toString();
    expect((await send('/logout', logout, 'null', login.cookie)).status).toBe(403);
    expect((await send('/logout', 'csrf=wrong', origin, login.cookie)).status).toBe(403);
    expect((await send('/logout', logout, origin, login.cookie)).status).toBe(303);
    expect((await send('/api/overview', undefined, undefined, login.cookie)).status).toBe(401);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
