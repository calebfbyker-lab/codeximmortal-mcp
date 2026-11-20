import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { evolveOnce } from './evolve.js';
import { listCandidates, reviewCandidate } from './review.js';
import { swarmOnce } from './swarm.js';

const url = process.env.TEST_DATABASE_URL;
if (process.env.REQUIRE_DB_TESTS === 'true' && !url) throw Error('TEST_DATABASE_URL_required');
if (url && process.env.CODEX_DB_TEST_ACK !== 'disposable-database-only') throw Error('disposable_database_ack_required');
describe.runIf(Boolean(url))('growth swarm and review against disposable PostgreSQL', () => {
  const schema = 'growth_swarm_test_' + randomUUID().replaceAll('-', '');
  const plan = { objective: 'Improve the dashboard', actions: ['Add evidence column'], risks: ['Approval control weakened'] };
  const sql = (text: string) => text.replaceAll('growth_runtime', schema);
  let pool: Pool | undefined;
  let scoped: Pool;
  let root: string | undefined;
  const query = (text: string, values?: unknown[]) => pool!.query(sql(text), values);
  const transport = () => vi.fn(async (_url: string, _init: RequestInit): Promise<Response> =>
    new Response(JSON.stringify({ done: true, message: { content: JSON.stringify(plan) } })));
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 6, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
    const client = await pool.connect();
    try {
      for (const file of ['007_growth_runtime.sql', '008_growth_candidates.sql'])
        await client.query(sql(readFileSync(new URL('../../migrations/' + file, import.meta.url), 'utf8')));
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
    scoped = { query } as unknown as Pool;
    root = mkdtempSync(join(tmpdir(), 'growth-swarm-'));
    mkdirSync(join(root, 'src/growth'), { recursive: true });
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(join(root, 'src/growth/runtime.ts'), 'export const x = 1;\n');
    writeFileSync(join(root, 'docs/growth-runtime.md'), '# Growth\nRuntime doc.\n');
  });
  beforeEach(async () => { await query('TRUNCATE growth_runtime.candidates'); });
  afterAll(async () => {
    try {
      if (pool) {
        try { await pool.query('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE'); }
        finally { await pool.end(); }
      }
    } finally { if (root) rmSync(root, { recursive: true, force: true }); }
  });
  it('stores one candidate per distinct model and later agents see earlier peers', async () => {
    const send = transport();
    const result = await swarmOnce(scoped, { models: ['llama3:latest', 'llama3.2:latest'], objective: 'Improve the dashboard', root, transport: send });
    expect(result.stored).toHaveLength(2);
    expect(new Set(result.stored.map(s => s.model))).toEqual(new Set(['llama3:latest', 'llama3.2:latest']));
    expect(send).toHaveBeenCalledTimes(2);
    const secondContext = JSON.parse(send.mock.calls[1]![1].body as string).messages[1].content;
    expect(secondContext).toContain('model=llama3:latest');
    expect((await query('SELECT count(*)::int AS n FROM growth_runtime.candidates')).rows[0].n).toBe(2);
  });
  it('rejects swarms larger than four models', async () => {
    const send = transport();
    await expect(swarmOnce(scoped, { models: ['a:latest', 'b:latest', 'c:latest', 'd:latest', 'e:latest'], objective: 'Anything', root, transport: send })).rejects.toThrow('invalid_models_1_to_4');
    expect(send).not.toHaveBeenCalled();
  });
  it('owner accepts a candidate once and cannot relabel it', async () => {
    const stored = await evolveOnce(scoped, { model: 'llama3:latest', objective: 'Label me', root, transport: transport(), includeHistory: false });
    const accepted = await reviewCandidate(scoped, stored.id, 'accepted');
    expect(accepted.status).toBe('accepted');
    await expect(reviewCandidate(scoped, stored.id, 'rejected')).rejects.toThrow('candidate_not_unreviewed');
    const listed = await listCandidates(scoped);
    expect(listed[0]).toMatchObject({ id: stored.id, status: 'accepted', model: 'llama3:latest' });
  });
  it('labeled outcomes feed the next planning context', async () => {
    const first = await evolveOnce(scoped, { model: 'llama3:latest', objective: 'Rejected idea', root, transport: transport(), includeHistory: false });
    await reviewCandidate(scoped, first.id, 'rejected');
    const send = transport();
    await evolveOnce(scoped, { model: 'llama3:latest', objective: 'Next idea', root, transport: send });
    const context = JSON.parse(send.mock.calls[0]![1].body as string).messages[1].content;
    expect(context).toContain('objective=Rejected idea');
    expect(context).toContain('status=rejected');
  });
});
