import express, { type ErrorRequestHandler, type Request } from 'express';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export interface OwnerConfig { origin: string; owner: string; saltHex: string; hashHex: string; revision: string }
const COOKIE = '__Host-codex_owner';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('base64url');
function equal(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// Not mounted by public http.ts. One-process prototype; not production deployment approval.
// Provision a high-entropy owner password and its scrypt verifier locally, never in chat.
// No registration, proxy identity, agent account, external IO, or payment capability.
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
      'Content-Security-Policy': "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      // no-referrer can turn native form POST Origin into null, breaking strict checks.
      'Referrer-Policy': 'same-origin' }); next();
  });
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
  app.get('/login', (_req, res) => res.type('html').send(
    '<!doctype html><title>Owner login</title><h1>Owner login</h1><form method=post action=/login>' +
    '<label>Owner <input name=owner autocomplete=username required></label>' +
    '<label>Password <input name=password type=password autocomplete=current-password required></label>' +
    '<button>Sign in</button></form>'));
  app.post('/login', (req, res) => {
    if (req.get('origin') !== origin) { res.status(403).json({ error: 'origin_denied' }); return; }
    if (now() - windowStart >= 60000) { windowStart = now(); attempts = 0; }
    if (++attempts > 5) { res.set('Retry-After', '60').status(429).json({ error: 'login_limited' }); return; }
    const body = req.body as Record<string, unknown> | undefined;
    if (!body || typeof body.owner !== 'string' || typeof body.password !== 'string' ||
        body.owner.length > 100 || body.password.length < 1 || body.password.length > 256) {
      res.status(401).json({ error: 'unauthorized' }); return;
    }
    const derived = scryptSync(body.password, Buffer.from(saltHex, 'hex'), 64);
    if (!timingSafeEqual(derived, expected) || body.owner !== owner) {
      res.status(401).json({ error: 'unauthorized' }); return;
    }
    const value = token();
    session = { hash: digest(value), csrf: token(), expires: now() + 900000 };
    res.set('Set-Cookie', COOKIE + '=' + value + '; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=900');
    res.redirect(303, '/');
  });
  app.get('/api/overview', (req, res) => {
    if (!current(req)) { res.status(401).json({ error: 'unauthorized' }); return; }
    res.json({ owner, configuredRevision: revision, serviceReadiness: 'not_evaluated',
      taskDispatch: false, liveSending: false, paymentAdministration: false });
  });
  app.get('/', (req, res) => {
    const s = current(req); if (!s) { res.redirect(303, '/login'); return; }
    res.type('html').send('<!doctype html><title>Owner control</title><h1>Owner control</h1>' +
      '<p>Owner: ' + owner + '</p><p>Configured revision: ' + revision + '</p>' +
      '<p>Service readiness: not evaluated. Task dispatch, live sending and payment administration are unavailable.</p>' +
      '<form method=post action=/logout><input type=hidden name=csrf value="' + s.csrf + '"><button>Sign out</button></form>');
  });
  app.post('/logout', (req, res) => {
    if (req.get('origin') !== origin) { res.status(403).json({ error: 'origin_denied' }); return; }
    const s = current(req); if (!s) { res.status(401).json({ error: 'unauthorized' }); return; }
    if (typeof req.body?.csrf !== 'string' || !equal(req.body.csrf, s.csrf)) {
      res.status(403).json({ error: 'csrf_denied' }); return;
    }
    session = undefined;
    res.set('Set-Cookie', COOKIE + '=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0');
    res.redirect(303, '/login');
  });
  const errors: ErrorRequestHandler = (_error, _req, res, _next) => {
    res.status(400).json({ error: 'invalid_request' });
  };
  app.use(errors);
  return app;
}
