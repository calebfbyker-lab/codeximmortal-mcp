import express, { type ErrorRequestHandler, type Request } from 'express';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { ownerConsole, ownerCss, ownerLogin, ownerOverview } from './owner-console.js';

export interface OwnerConfig { origin: string; owner: string; saltHex: string; hashHex: string; revision: string }
const COOKIE = '__Host-codex_owner';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('base64url');
function equal(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// Isolated single-process local console; never mounted by public http.ts.
export function createOwnerControlApp(input?: OwnerConfig, now: () => number = Date.now) {
  if (!input || !/^[A-Za-z0-9_.@-]{1,100}$/.test(input.owner) ||
      !/^[a-f0-9]{32}$/.test(input.saltHex) || !/^[a-f0-9]{128}$/.test(input.hashHex) ||
      !/^[a-f0-9]{40}$/.test(input.revision)) throw new Error('owner_configuration_required');
  const { origin, owner, saltHex, hashHex, revision } = input;
  try { const url = new URL(origin); if (url.protocol !== 'https:' || url.origin !== origin) throw new Error(); }
  catch { throw new Error('owner_configuration_required'); }
  const expected = Buffer.from(hashHex, 'hex');
  let session: { hash: string; csrf: string; expires: number } | undefined;
  let windowStart = now(), attempts = 0;
  const app = express();
  app.disable('x-powered-by'); app.set('trust proxy', false);
  app.use((_req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      'Referrer-Policy': 'same-origin' }); next();
  });
  // Only static, non-sensitive CSS is public. All overview data requires a valid session.
  app.get('/assets/owner.css', (_req, res) => { res.type('css').send(ownerCss); });
  app.use(express.json({ limit: '2kb', strict: true }));
  app.use(express.urlencoded({ extended: false, limit: '2kb', parameterLimit: 5 }));
  function current(req: Request) {
    if (session && session.expires <= now()) session = undefined;
    const cookie = req.headers.cookie ?? '';
    if (cookie.length > 4096) return undefined;
    const values = cookie.split(';').map(v => v.trim()).filter(v => v.startsWith(COOKIE + '='));
    if (values.length !== 1) return undefined;
    const value = values[0].slice(COOKIE.length + 1);
    return /^[A-Za-z0-9_-]{43}$/.test(value) && session && equal(digest(value), session.hash) ? session : undefined;
  }
  app.get('/login', (_req, res) => { res.type('html').send(ownerLogin()); });
  app.post('/login', (req, res) => {
    function fail(status: number, error: string) {
      res.status(status);
      if (req.is('application/x-www-form-urlencoded')) res.type('html').send(ownerLogin(error));
      else res.json({ error });
    }
    if (req.get('origin') !== origin) { fail(403, 'origin_denied'); return; }
    if (now() - windowStart >= 60000) { windowStart = now(); attempts = 0; }
    if (++attempts > 5) { res.set('Retry-After', '60'); fail(429, 'login_limited'); return; }
    const body = req.body as Record<string, unknown> | undefined;
    if (!body || typeof body.owner !== 'string' || typeof body.password !== 'string' ||
        body.owner.length > 100 || body.password.length < 1 || body.password.length > 256) { fail(401, 'unauthorized'); return; }
    const derived = scryptSync(body.password, Buffer.from(saltHex, 'hex'), 64);
    if (!timingSafeEqual(derived, expected) || body.owner !== owner) { fail(401, 'unauthorized'); return; }
    const value = token();
    session = { hash: digest(value), csrf: token(), expires: now() + 900000 };
    res.set('Set-Cookie', COOKIE + '=' + value + '; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=900');
    res.redirect(303, '/');
  });
  app.get('/api/overview', (req, res) => {
    const s = current(req); if (!s) { res.status(401).json({ error: 'unauthorized' }); return; }
    if (req.query.download === '1') res.set('Content-Disposition', 'attachment; filename=owner-snapshot.json');
    res.json(ownerOverview(owner, revision, now(), s.expires));
  });
  app.get('/', (req, res) => {
    const s = current(req); if (!s) { res.redirect(303, '/login'); return; }
    res.type('html').send(ownerConsole(ownerOverview(owner, revision, now(), s.expires), s.csrf, { view: req.query.view, q: req.query.q }));
  });
  app.post('/logout', (req, res) => {
    if (req.get('origin') !== origin) { res.status(403).json({ error: 'origin_denied' }); return; }
    const s = current(req); if (!s) { res.status(401).json({ error: 'unauthorized' }); return; }
    if (typeof req.body?.csrf !== 'string' || !equal(req.body.csrf, s.csrf)) { res.status(403).json({ error: 'csrf_denied' }); return; }
    session = undefined;
    res.set('Set-Cookie', COOKIE + '=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0');
    res.redirect(303, '/login');
  });
  const errors: ErrorRequestHandler = (_error, _req, res, _next) => { res.status(400).json({ error: 'invalid_request' }); };
  app.use(errors);
  return app;
}
