import { describe, it, expect } from 'vitest';
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { scryptSync } from 'node:crypto';
import { createOwnerControlApp } from './owner-app.js';
import type { AnalyticsStore } from './owner-analytics.js';
import { LeadTransitionError, type LeadTransitionCommand } from './owner-lead-transitions.js';
import type { PipelineWorkflow } from './owner-pipeline.js';

const origin = 'https://owner.example.test';
const password = 'synthetic-pipeline-password';
const saltHex = '12'.repeat(16);
const config = { origin, owner: 'owner', saltHex, revision: 'a'.repeat(40), hashHex: scryptSync(password, Buffer.from(saltHex, 'hex'), 64).toString('hex') };
function send(base: string, path: string, body?: string, headers: Record<string,string> = {}) {
  return new Promise<{ status: number; text: string; cookie: string; location: string }>((resolve,reject) => {
    const req = request(base + path, { agent: false, method: body === undefined ? 'GET' : 'POST', headers: { ...headers, ...(body === undefined ? {} : { 'Content-Length': Buffer.byteLength(body) }) } }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', c => { text += c; }); res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode!, text, cookie: res.headers['set-cookie']?.[0]?.split(';')[0] ?? '', location: String(res.headers.location ?? '') }));
    }); req.setTimeout(5000, () => req.destroy(new Error('fixture_timeout'))); req.on('error', reject); req.end(body);
  });
}
async function fixture(run: (f: { base: string; cookie: string; csrf: string; seen: LeadTransitionCommand[] }) => Promise<void>, fail = false) {
  const seen: LeadTransitionCommand[] = [];
  const workflow: PipelineWorkflow = {
    list: async () => [{ id: '22222222-2222-4222-8222-222222222222', name: '<script>bad</script>', stage: 'new' }],
    approve: async command => { if (fail) throw new LeadTransitionError('lead_stage_conflict'); seen.push(command); return { replayed: false }; },
  };
  const analytics: AnalyticsStore = {
    pipeline: async () => ({ stages: [{ stage: 'new', count: 1, valueMinor: 0 }], leadCount: 1, wonValueMinor: 0, conversionPercent: 0, currency: 'USD', currencies: ['USD'] }),
    revenueSummary: async () => { throw new Error('unused'); }, upsertRevenueEvents: async () => 0, addLead: async () => { throw new Error('unused'); },
  };
  const server: Server = createOwnerControlApp(config, Date.now, undefined, undefined, analytics, workflow).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  try {
    const login = await send(base, '/login', JSON.stringify({ owner: 'owner', password }), { Origin: origin, 'Content-Type': 'application/json' });
    expect(login.status).toBe(303);
    const page = await send(base, '/?view=pipeline', undefined, { Cookie: login.cookie });
    const csrf = /name=csrf value="([^"]+)"/.exec(page.text)?.[1]; if (!csrf) throw new Error('fixture_csrf');
    await run({ base, cookie: login.cookie, csrf, seen });
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
const fields = (csrf: string) => ({ csrf, commandId: '11111111-1111-4111-8111-111111111111', leadId: '22222222-2222-4222-8222-222222222222', from: 'new', to: 'qualified', reason: 'Owner reviewed fit' });
describe('Pipeline through actual owner app guards', () => {
  it('retains analytics and renders escaped lead controls without a false unconfigured warning', async () => fixture(async f => {
    const page = await send(f.base, '/?view=pipeline', undefined, { Cookie: f.cookie });
    expect(page.text).toContain('Won value'); expect(page.text).toContain('Governed lead transitions');
    expect(page.text).not.toContain('Analytics are not configured'); expect(page.text).not.toContain('<script>bad</script>');
  }));
  it('accepts all six urlencoded fields and forwards only the exact command', async () => fixture(async f => {
    const body = fields(f.csrf);
    const result = await send(f.base, '/leads/transition', new URLSearchParams(body).toString(), { Cookie: f.cookie, Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' });
    expect(result.status).toBe(303); expect(result.location).toBe('/?view=pipeline&lead_status=approved');
    const { csrf: _csrf, ...command } = body; expect(f.seen).toEqual([command]);
  }));
  it('rejects missing sessions, wrong Origin and wrong CSRF before calling the store', async () => fixture(async f => {
    const body = JSON.stringify(fields(f.csrf));
    expect((await send(f.base, '/leads/transition', body, { Origin: origin, 'Content-Type': 'application/json' })).status).toBe(401);
    expect((await send(f.base, '/leads/transition', body, { Cookie: f.cookie, Origin: 'https://foreign.example.test', 'Content-Type': 'application/json' })).status).toBe(403);
    expect((await send(f.base, '/leads/transition', JSON.stringify(fields('wrong')), { Cookie: f.cookie, Origin: origin, 'Content-Type': 'application/json' })).status).toBe(403);
    expect(f.seen).toEqual([]);
  }));
  it('rejects actor injection and returns JSON success for valid commands', async () => fixture(async f => {
    const headers = { Cookie: f.cookie, Origin: origin, 'Content-Type': 'application/json' };
    expect((await send(f.base, '/leads/transition', JSON.stringify({ ...fields(f.csrf), actor: 'admin' }), headers)).status).toBe(400);
    expect((await send(f.base, '/leads/transition', JSON.stringify(fields(f.csrf)), headers)).status).toBe(200);
    expect(f.seen).toHaveLength(1);
  }));
  it('returns a conflict without reporting success when the stage is stale', async () => fixture(async f => {
    const result = await send(f.base, '/leads/transition', JSON.stringify(fields(f.csrf)), { Cookie: f.cookie, Origin: origin, 'Content-Type': 'application/json' });
    expect(result.status).toBe(409); expect(JSON.parse(result.text)).toEqual({ error: 'lead_stage_conflict' });
  }, true));
});
