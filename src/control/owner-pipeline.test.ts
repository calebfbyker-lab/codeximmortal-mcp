import { describe, it, expect } from 'vitest';
import express from 'express';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { registerOwnerPipeline } from './owner-pipeline.js';

async function fixture(guard: 'session'|'origin'|'csrf'|'allow', run: (base: string) => Promise<void>) {
  const app = express(); app.use(express.json());
  registerOwnerPipeline(app, {
    owner: 'owner', revision: 'a'.repeat(40), now: () => 1000,
    current: () => guard === 'session' ? undefined : { csrf: 'token', expires: 901000 },
    guarded: (_req,res) => { if (guard !== 'allow') { res.status(guard === 'session' ? 401 : 403).json({ error: guard }); return undefined; } return true; },
    workflow: { list: async () => [{ id: 'lead-1', name: '<script>attack</script>', stage: 'new' }], approve: async () => ({ replayed: false }) },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try { await run('http://127.0.0.1:' + (server.address() as AddressInfo).port); }
  finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
function send(base: string, path: string, post = false) {
  return new Promise<{ status: number; text: string }>((resolve,reject) => {
    const req = request(base + path, { method: post ? 'POST' : 'GET', agent: false }, res => {
      let text = ''; res.on('data', c => { text += c; }); res.on('end', () => resolve({ status: res.statusCode!, text }));
    }); req.on('error', reject); req.end();
  });
}
describe('pipeline integration module (stub guard contracts)', () => {
  it('redirects unauthenticated views', async () => fixture('session', async base => { expect((await send(base, '/?view=pipeline')).status).toBe(303); }));
  it('honors each rejected mutation guard', async () => {
    for (const guard of ['session','origin','csrf'] as const) await fixture(guard, async base => { expect((await send(base, '/leads/transition', true)).status).toBe(guard === 'session' ? 401 : 403); });
  });
  it('renders escaped lead names and required approval fields', async () => fixture('allow', async base => {
    const result = await send(base, '/?view=pipeline');
    expect(result.status).toBe(200); expect(result.text).not.toContain('<script>attack</script>');
    expect(result.text).toContain('&'+'lt;script'+'&'+'gt;');
    expect(result.text).toContain('action=/leads/transition'); expect(result.text).toContain('name=csrf value="token"');
    expect(result.text).toContain('name=commandId'); expect(result.text).toContain('name=from');
  }));
});
