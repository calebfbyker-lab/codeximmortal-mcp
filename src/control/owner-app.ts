import express, { type ErrorRequestHandler, type Request, type Response } from 'express';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { ownerConsole, ownerCss, ownerLogin, ownerOverview, type OwnerConsoleTasks } from './owner-console.js';
import type { OwnerTask, OwnerTaskView } from './owner-task-queue.js';
import type { OwnerGovernanceAgent, OwnerGovernanceView } from './owner-governance.js';

export interface OwnerConfig { origin: string; owner: string; saltHex: string; hashHex: string; revision: string }
export interface OwnerTaskStore {
  propose(key: string, objective: string, baseline: string): Promise<OwnerTask>;
  approve(id: string): Promise<void>;
  cancel(id: string): Promise<void>;
  pause(paused: boolean): Promise<void>;
  view(): Promise<OwnerTaskView>;
}
export interface OwnerGovernanceStore {
  activePolicy(kind: string): Promise<OwnerGovernanceView>;
  recordApproval(taskId: string, policyKind: string, policyVersion: number, action: string, decision: 'approved' | 'denied'): Promise<void>;
  audit(eventType: string, actor: string, payload?: Record<string, unknown>): Promise<void>;
  verifyChain(limit?: number): Promise<boolean>;
  listAgents(): Promise<OwnerGovernanceAgent[]>;
}
const COOKIE = '__Host-codex_owner';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const isUuid = (value: string) => /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
function equal(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
const configurationErrors = new Set(['owner_task_database_not_configured', 'owner_task_database_unavailable',
  'owner_governance_database_unavailable', 'owner_task_not_initialized', 'policy_unavailable_or_tampered']);
const knownTaskErrors = new Set([...configurationErrors, 'invalid_task_proposal', 'invalid_task_id', 'command_conflict',
  'task_capacity_reached', 'invalid_objective', 'invalid_baseline', 'task_transition_denied', 'owner_task_failed']);

// Isolated single-process local console; never mounted by public http.ts.
export function createOwnerControlApp(input?: OwnerConfig, now: () => number = Date.now, tasks?: OwnerTaskStore, governance?: OwnerGovernanceStore) {
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
  const isForm = (req: Request) => Boolean(req.is('application/x-www-form-urlencoded'));
  function accepted(req: Request, res: Response) { if (isForm(req)) res.redirect(303, '/?view=tasks'); else res.json({ accepted: true }); }
  function rejected(req: Request, res: Response, code: string) {
    if (isForm(req)) res.redirect(303, '/?view=tasks&error=' + encodeURIComponent(code));
    else res.status(configurationErrors.has(code) ? 503 : 400).json({ error: code });
  }
  function failure(req: Request, res: Response, error: unknown) {
    rejected(req, res, error instanceof Error && knownTaskErrors.has(error.message) ? error.message : 'owner_task_failed');
  }
  function guarded(req: Request, res: Response) {
    if (req.get('origin') !== origin) { res.status(403).json({ error: 'origin_denied' }); return undefined; }
    const s = current(req);
    if (!s) { res.status(401).json({ error: 'unauthorized' }); return undefined; }
    const body = req.body as Record<string, unknown> | undefined;
    if (!body || typeof body.csrf !== 'string' || !equal(body.csrf, s.csrf)) { res.status(403).json({ error: 'csrf_denied' }); return undefined; }
    return s;
  }
  function requireStore(req: Request, res: Response): OwnerTaskStore | undefined {
    if (!tasks) { rejected(req, res, 'owner_task_database_not_configured'); return undefined; }
    return tasks;
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
    res.json(ownerOverview(owner, revision, now(), s.expires, Boolean(tasks)));
  });
  app.get('/api/tasks', async (req, res) => {
    const s = current(req); if (!s) { res.status(401).json({ error: 'unauthorized' }); return; }
    if (!tasks) { res.json({ configured: false }); return; }
    try { res.json({ configured: true, ...await tasks.view() }); }
    catch { res.status(503).json({ error: 'owner_task_database_unavailable' }); }
  });
  app.get('/', async (req, res) => {
    const s = current(req); if (!s) { res.redirect(303, '/login'); return; }
    let consoleTasks: OwnerConsoleTasks | undefined;
    if (tasks) {
      let view: OwnerTaskView | undefined; let databaseUnavailable = false;
      try { view = await tasks.view(); } catch { databaseUnavailable = true; }
      let gov: OwnerConsoleTasks['governance'];
      if (governance) {
        try { gov = { policy: await governance.activePolicy('owner_task_dispatch'), chainVerified: await governance.verifyChain(100), agents: await governance.listAgents() }; }
        catch { gov = { unavailable: true }; }
      }
      consoleTasks = { configured: true, view, databaseUnavailable, proposeKey: randomUUID(), governance: gov };
    }
    res.type('html').send(ownerConsole(ownerOverview(owner, revision, now(), s.expires, Boolean(tasks)), s.csrf,
      { view: req.query.view, q: req.query.q, error: req.query.error }, consoleTasks));
  });
  app.post('/tasks/propose', async (req, res) => {
    if (!guarded(req, res)) return;
    const store = requireStore(req, res); if (!store) return;
    const body = req.body as Record<string, unknown> | undefined;
    const key = typeof body?.command_key === 'string' ? body.command_key : '';
    const objective = typeof body?.objective === 'string' ? body.objective : '';
    if (!isUuid(key) || objective.length > 400 || objective.trim().length < 1) { rejected(req, res, 'invalid_task_proposal'); return; }
    try {
      if (governance) await governance.activePolicy('owner_task_dispatch');
      const task = await store.propose(key, objective, revision);
      if (governance) await governance.audit('task_proposed', owner, { taskId: task.id });
      accepted(req, res);
    } catch (error) { failure(req, res, error); }
  });
  app.post('/tasks/approve', async (req, res) => {
    if (!guarded(req, res)) return;
    const store = requireStore(req, res); if (!store) return;
    const body = req.body as Record<string, unknown> | undefined;
    const id = typeof body?.task === 'string' ? body.task : '';
    if (!isUuid(id)) { rejected(req, res, 'invalid_task_id'); return; }
    try {
      await store.approve(id);
      if (governance) {
        const policy = await governance.activePolicy('owner_task_dispatch');
        await governance.recordApproval(id, 'owner_task_dispatch', policy.version, 'task_approve', 'approved');
        await governance.audit('task_approved', owner, { taskId: id });
      }
      accepted(req, res);
    } catch (error) { failure(req, res, error); }
  });
  app.post('/tasks/cancel', async (req, res) => {
    if (!guarded(req, res)) return;
    const store = requireStore(req, res); if (!store) return;
    const body = req.body as Record<string, unknown> | undefined;
    const id = typeof body?.task === 'string' ? body.task : '';
    if (!isUuid(id)) { rejected(req, res, 'invalid_task_id'); return; }
    try {
      await store.cancel(id);
      if (governance) await governance.audit('task_cancelled', owner, { taskId: id });
      accepted(req, res);
    } catch (error) { failure(req, res, error); }
  });
  const dispatch = (target: boolean, eventType: string) => async (req: Request, res: Response) => {
    if (!guarded(req, res)) return;
    const store = requireStore(req, res); if (!store) return;
    try {
      await store.pause(target);
      if (governance) await governance.audit(eventType, owner);
      accepted(req, res);
    } catch (error) { failure(req, res, error); }
  };
  app.post('/tasks/pause', dispatch(true, 'dispatch_paused'));
  app.post('/tasks/resume', dispatch(false, 'dispatch_resumed'));
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
