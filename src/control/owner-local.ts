import { readFileSync } from 'node:fs';
import { randomBytes, scryptSync } from 'node:crypto';
import { createServer, request } from 'node:https';
import { pathToFileURL } from 'node:url';
import { createOwnerControlApp } from './owner-app.js';

export function localOwnerConfig(env: NodeJS.ProcessEnv) {
  const password = env.CODEX_OWNER_LOCAL_PASSWORD ?? '';
  const revision = env.CODEX_OWNER_LOCAL_REVISION ?? '';
  const pfxFile = env.CODEX_OWNER_LOCAL_PFX ?? '';
  const passphrase = env.CODEX_OWNER_LOCAL_PFX_PASSWORD ?? '';
  const caFile = env.CODEX_OWNER_LOCAL_CA ?? '';
  if (password.length < 20 || password.length > 256 || !/^[a-f0-9]{40}$/.test(revision) ||
      !pfxFile || !caFile || passphrase.length < 16) throw new Error('owner_local_configuration_required');
  const salt = randomBytes(16);
  return { pfxFile, passphrase, caFile, app: { origin: 'https://localhost:8443', owner: 'owner',
    revision, saltHex: salt.toString('hex'), hashHex: scryptSync(password, salt, 64).toString('hex') } };
}
async function main() {
  const settings = localOwnerConfig(process.env);
  let password = process.env.CODEX_OWNER_LOCAL_PASSWORD ?? '';
  delete process.env.CODEX_OWNER_LOCAL_PASSWORD;
  const ca = readFileSync(settings.caFile);
  const server = createServer({ pfx: readFileSync(settings.pfxFile), passphrase: settings.passphrase,
    minVersion: 'TLSv1.2' }, createOwnerControlApp(settings.app));
  function probe(path: string, body?: string, cookie?: string) {
    return new Promise<{ status: number; text: string; cookie: string }>((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port: 8443, servername: 'localhost', ca,
        path, method: body === undefined ? 'GET' : 'POST', agent: false,
        headers: { Host: 'localhost:8443', Connection: 'close',
          ...(cookie ? { Cookie: cookie } : {}),
          ...(body === undefined ? {} : { Origin: settings.app.origin, 'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body) }) } }, res => {
        let text = ''; res.setEncoding('utf8');
        res.on('data', chunk => { text += chunk; if (text.length > 32768) res.destroy(new Error('probe_limit')); });
        res.on('error', reject);
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text, cookie: res.headers['set-cookie']?.[0]?.split(';')[0] ?? '' }));
      });
      req.setTimeout(5000, () => req.destroy(new Error('probe_timeout')));
      req.on('error', reject); req.end(body);
    });
  }
  const stop = () => { server.closeAllConnections(); server.close(); };
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(8443, '127.0.0.1', resolve); });
    if ((await probe('/login')).status !== 200 || (await probe('/api/overview')).status !== 401) throw new Error();
    const login = await probe('/login', JSON.stringify({ owner: 'owner', password }));
    password = '';
    if (login.status !== 303 || !login.cookie) throw new Error();
    if ((await probe('/api/overview', undefined, login.cookie)).status !== 200) throw new Error();
    const page = await probe('/', undefined, login.cookie);
    const csrf = /name=csrf value="([^"]+)"/.exec(page.text)?.[1];
    if (page.status !== 200 || !csrf ||
        (await probe('/logout', JSON.stringify({ csrf }), login.cookie)).status !== 303 ||
        (await probe('/api/overview', undefined, login.cookie)).status !== 401) throw new Error();
    console.log('Owner HTTPS login, overview and logout self-check passed.');
    console.log('Open https://localhost:8443/login ; username: owner ; use the password entered locally.');
    console.log('Read-only prototype. No agents, task execution, payments or live sending are enabled. Ctrl+C stops it.');
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  } catch { password = ''; stop(); throw new Error('owner_local_start_failed'); }
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  void main().catch(() => { console.error('Owner dashboard startup failed. Check build/tests, local certificate configuration and port 8443. No secrets logged.'); process.exitCode = 1; });
}
