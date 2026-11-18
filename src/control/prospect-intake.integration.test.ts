import { describe, expect, it, vi } from 'vitest';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { scryptSync } from 'node:crypto';
import { createOwnerControlApp } from './owner-app.js';
import type { AnalyticsStore } from './owner-analytics.js';
import { prospectIntake } from './prospect-assistant.js';
const origin = 'https://owner.example.test', password = 'synthetic-prospect-password';
const saltHex = '12'.repeat(16);
const config = { origin, owner: 'owner', saltHex, revision: 'a'.repeat(40), hashHex: scryptSync(password, Buffer.from(saltHex, 'hex'), 64).toString('hex') };
function send(base: string, path: string, body?: unknown, headers: Record<string,string> = {}) {
  return new Promise<{ status: number; text: string; cookie: string }>((resolve,reject) => {
    const text = body === undefined ? undefined : JSON.stringify(body);
    const req = request(base + path, { agent: false, method: text === undefined ? 'GET' : 'POST', headers: { ...headers,
      ...(text === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) }) } }, res => {
      let value = ''; res.setEncoding('utf8'); res.on('data', c => { value += c; }); res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text: value, cookie: res.headers['set-cookie']?.[0]?.split(';')[0] ?? '' }));
    });
    req.setTimeout(5000, () => req.destroy(new Error('test_timeout'))); req.on('error', reject); req.end(text);
  });
}
async function fixture(run: (f: { base: string; cookie: string; csrf: string; addLead: ReturnType<typeof vi.fn> }) => Promise<void>) {
  const addLead = vi.fn().mockImplementation(async input => ({ ...input, id: 'lead-1', stage: 'new', createdAt: new Date(), updatedAt: new Date() }));
  const analytics: AnalyticsStore = { addLead, pipeline: async () => ({ stages: [], leadCount: 0, wonValueMinor: 0, conversionPercent: null }),
    revenueSummary: async () => { throw new Error('unused'); }, upsertRevenueEvents: async () => 0 };
  const server = createOwnerControlApp(config, Date.now, undefined, undefined, analytics, {
    list: async () => [{ id: 'lead-1', name: '<script>bad</script>', stage: 'new', source: '<b>source</b>', notes: '<script>notes</script>' }],
    approve: async () => ({ replayed: false })
  }).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  try {
    const login = await send(base, '/login', { owner: 'owner', password }, { Origin: origin });
    expect(login.status).toBe(303);
    const page = await send(base, '/?view=pipeline', undefined, { Cookie: login.cookie });
    const csrf = /name=csrf value="([^"]+)"/.exec(page.text)?.[1]; if (!csrf) throw new Error('missing_csrf');
    await run({ base, cookie: login.cookie, csrf, addLead });
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
const input = { name: 'Synthetic prospect', source: 'owner-test', need: 'Compare pricing changes' };
describe('prospect intake and bounded rules assistance', () => {
  it('labels evidence unverified and preserves planned-service availability', () => {
    const result = prospectIntake(input); const notes = JSON.parse(result.notes);
    expect(result.valueMinor).toBe(0); expect(notes.method).toBe('rules-v1');
    expect(notes.evidence).toBe('owner_recorded_unverified'); expect(notes.contactPermission).toBe('not_established');
    expect(notes.matches.length).toBeGreaterThan(0);
    expect(notes.matches.every((s: {status:string; registered:boolean}) => s.status === 'planned' && !s.registered)).toBe(true);
    expect(notes.draft).toContain('pre-release');
  });
  it('rejects injected authority, oversized and control-character inputs', () => {
    expect(() => prospectIntake({ ...input, buyerId: 'forged' })).toThrow('invalid_prospect_input');
    expect(() => prospectIntake({ ...input, need: 'x'.repeat(601) })).toThrow('invalid_prospect_input');
    expect(() => prospectIntake({ ...input, source: 'bad\nsource' })).toThrow('invalid_prospect_input');
  });
  it('does not invent product fit for unrelated needs', () => {
    expect(JSON.parse(prospectIntake({ ...input, need: 'Please clarify our requirements' }).notes).matches).toEqual([]);
  });
  it('renders intake and escaped prospect evidence in actual owner app', async () => fixture(async f => {
    const page = await send(f.base, '/?view=pipeline', undefined, { Cookie: f.cookie });
    expect(page.text).toContain('action=/leads/intake'); expect(page.text).toContain('Rules-based assistance only');
    expect(page.text).not.toContain('<script>bad</script>'); expect(page.text).not.toContain('<script>notes</script>');
    expect(page.text).not.toContain('<b>source</b>');
  }));
  it('requires session, origin and CSRF before persistence', async () => fixture(async f => {
    const body = { ...input, csrf: f.csrf };
    expect((await send(f.base, '/leads/intake', body, { Origin: origin })).status).toBe(401);
    expect((await send(f.base, '/leads/intake', body, { Cookie: f.cookie, Origin: 'https://other.example.test' })).status).toBe(403);
    expect((await send(f.base, '/leads/intake', { ...body, csrf: 'wrong' }, { Cookie: f.cookie, Origin: origin })).status).toBe(403);
    expect(f.addLead).not.toHaveBeenCalled();
  }));
  it('persists only server-generated assessment with no stage or value override', async () => fixture(async f => {
    const headers = { Cookie: f.cookie, Origin: origin };
    expect((await send(f.base, '/leads/intake', { ...input, csrf: f.csrf, stage: 'won' }, headers)).status).toBe(400);
    const response = await send(f.base, '/leads/intake', { ...input, csrf: f.csrf }, headers);
    expect(response.status).toBe(201); expect(f.addLead).toHaveBeenCalledTimes(1);
    expect(f.addLead.mock.calls[0]![0]).toEqual(prospectIntake(input));
    f.addLead.mockRejectedValueOnce(new Error('private-database-secret'));
    const failed = await send(f.base, '/leads/intake', { ...input, csrf: f.csrf }, headers);
    expect(failed.status).toBe(503); expect(failed.text).not.toContain('private-database-secret');
  }));
});
