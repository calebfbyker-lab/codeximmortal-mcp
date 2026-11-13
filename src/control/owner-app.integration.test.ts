import { afterEach, describe, expect, it } from 'vitest';
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { scryptSync } from 'node:crypto';
import { createOwnerControlApp, type OwnerConfig } from './owner-app.js';
const password = 'synthetic-owner-password-only';
const origin = 'https://owner.example.test';
const saltHex = '12'.repeat(16);
const config: OwnerConfig = { origin, owner: 'owner', saltHex,
  hashHex: scryptSync(password, Buffer.from(saltHex, 'hex'), 64).toString('hex'),
  revision: '89515a3b706edbafb240e86b5bad4ad03c4bbcbd' };
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.closeAllConnections(); server.close(error => error ? reject(error) : resolve());
  })));
});
async function start(now?: () => number) {
  const server = createOwnerControlApp(config, now).listen(0, '127.0.0.1'); servers.push(server);
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
function http(url: string, path: string, body?: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: string; cookie: string }>((resolve, reject) => {
    const req = request(new URL(path, url), { agent: false, method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }), ...headers } }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text, cookie: res.headers['set-cookie']?.[0] ?? '' }));
      res.on('error', reject);
    });
    req.setTimeout(5000, () => req.destroy(new Error('test_http_timeout')));
    req.on('error', reject); req.end(body);
  });
}
async function login(url: string, owner = 'owner', secret = password) {
  return http(url, '/login', JSON.stringify({ owner, password: secret }), { Origin: origin });
}
const cookieOnly = (value: string) => value.split(';')[0];
describe('isolated owner control HTTP boundary (synthetic credentials)', () => {
  it('fails closed without configuration or with an insecure origin', () => {
    expect(() => createOwnerControlApp()).toThrow('owner_configuration_required');
    expect(() => createOwnerControlApp({ ...config, origin: 'http://owner.example.test' })).toThrow('owner_configuration_required');
  });
  it('rejects missing identity and forged owner/agent headers', async () => {
    const url = await start();
    expect((await http(url, '/api/overview')).status).toBe(401);
    expect((await http(url, '/api/overview', undefined, { 'X-Owner': 'owner', Authorization: 'Bearer agent' })).status).toBe(401);
  });
  it('rejects wrong passwords and non-owner credentials', async () => {
    const url = await start();
    expect((await login(url, 'owner', 'wrong')).status).toBe(401);
    expect((await login(url, 'agent')).status).toBe(401);
  });
  it('requires the configured origin for login', async () => {
    const url = await start(); const body = JSON.stringify({ owner: 'owner', password });
    expect((await http(url, '/login', body)).status).toBe(403);
    expect((await http(url, '/login', body, { Origin: 'https://other.example.test' })).status).toBe(403);
  });
  it('authenticates the owner with secure cookie flags and a protected read-only view', async () => {
    const url = await start(); const result = await login(url); expect(result.status).toBe(303);
    for (const flag of ['Secure', 'HttpOnly', 'SameSite=Strict', 'Path=/']) expect(result.cookie).toContain(flag);
    const headers = { Cookie: cookieOnly(result.cookie) };
    const overview = await http(url, '/api/overview', undefined, headers); expect(overview.status).toBe(200);
    expect(JSON.parse(overview.body)).toMatchObject({ owner: 'owner', taskDispatch: false, serviceReadiness: 'not_evaluated' });
    expect((await http(url, '/', undefined, headers)).body).toContain('Owner control');
    expect(overview.body).not.toContain(config.hashHex); expect(overview.body).not.toContain(password);
  });
  it('rotates sessions and rejects duplicate session cookies', async () => {
    const url = await start(); const first = cookieOnly((await login(url)).cookie);
    const second = cookieOnly((await login(url)).cookie); expect(first).not.toBe(second);
    expect((await http(url, '/api/overview', undefined, { Cookie: first })).status).toBe(401);
    expect((await http(url, '/api/overview', undefined, { Cookie: second + '; ' + second })).status).toBe(401);
  });
  it('expires sessions and does not persist them across app reconstruction', async () => {
    let time = 1000; const url = await start(() => time);
    const headers = { Cookie: cookieOnly((await login(url)).cookie) };
    expect((await http(await start(), '/api/overview', undefined, headers)).status).toBe(401);
    time += 900001; expect((await http(url, '/api/overview', undefined, headers)).status).toBe(401);
  });
  it('enforces origin and CSRF for logout and invalidates the session', async () => {
    const url = await start(); const Cookie = cookieOnly((await login(url)).cookie);
    expect((await http(url, '/logout', '{}', { Cookie })).status).toBe(403);
    expect((await http(url, '/logout', '{}', { Cookie, Origin: origin })).status).toBe(403);
    const page = await http(url, '/', undefined, { Cookie });
    const csrf = /name=csrf value="([^"]+)"/.exec(page.body)?.[1]; expect(csrf).toBeTruthy();
    expect((await http(url, '/logout', JSON.stringify({ csrf }), { Cookie, Origin: origin })).status).toBe(303);
    expect((await http(url, '/api/overview', undefined, { Cookie })).status).toBe(401);
  });
  it('limits login work globally without trusting proxy headers', async () => {
    const url = await start(); for (let i = 0; i < 5; i++) expect((await login(url, 'owner', 'wrong')).status).toBe(401);
    expect((await login(url)).status).toBe(429);
  });
  it('redacts malformed input and has no task-dispatch route', async () => {
    const url = await start(); const malformed = await http(url, '/login', '{"private-marker":', { Origin: origin });
    expect(malformed.status).toBe(400); expect(malformed.body).not.toContain('private-marker');
    expect((await http(url, '/tasks', '{}', { Origin: origin })).status).toBe(404);
  });
});
