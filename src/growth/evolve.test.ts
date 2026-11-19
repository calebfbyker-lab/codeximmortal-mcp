import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { evolveOnce } from './evolve.js';

const url = process.env.TEST_DATABASE_URL;
if (process.env.REQUIRE_DB_TESTS === 'true' && !url) throw Error('TEST_DATABASE_URL_required');
if (url && process.env.CODEX_DB_TEST_ACK !== 'disposable-database-only') throw Error('disposable_database_ack_required');
describe.runIf(Boolean(url))('growth evolve loop against disposable PostgreSQL', () => {
  const schema = 'growth_evolve_test_' + randomUUID().replaceAll('-', '');
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
    root = mkdtempSync(join(tmpdir(), 'growth-evolve-'));
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
  it('stores a candidate built from repo context', async () => {
    const send = transport();
    const result = await evolveOnce(scoped, { model: 'llama3:latest', objective: 'Improve the dashboard', root, transport: send, includeHistory: false });
    expect(result.duplicate).toBe(false);
    const row = (await query('SELECT model, objective, plan FROM growth_runtime.candidates')).rows[0];
    expect(row).toMatchObject({ model: 'llama3:latest', objective: 'Improve the dashboard', plan });
    expect(send).toHaveBeenCalledTimes(1);
    const body = JSON.parse(send.mock.calls[0]![1].body as string);
    expect(body.model).toBe('llama3:latest');
    expect(body.messages[1].content).toContain('Improve the dashboard');
    expect(body.messages[1].content).toContain('src/growth');
  });
  it('dedupes identical planning runs without a second row', async () => {
    const send = transport();
    const options = { model: 'llama3:latest', objective: 'Stable objective', root, transport: send, includeHistory: false };
    const first = await evolveOnce(scoped, options);
    const second = await evolveOnce(scoped, options);
    expect(second.duplicate).toBe(true);
    expect(second.id).toBe(first.id);
    expect((await query('SELECT count(*)::int AS n FROM growth_runtime.candidates')).rows[0].n).toBe(1);
  });
  it('feeds prior candidates into the next planning context', async () => {
    const send = transport();
    await evolveOnce(scoped, { model: 'llama3:latest', objective: 'First improvement', root, transport: send, includeHistory: false });
    await evolveOnce(scoped, { model: 'llama3:latest', objective: 'Second improvement', root, transport: send });
    expect(send).toHaveBeenCalledTimes(2);
    const context = JSON.parse(send.mock.calls[1]![1].body as string).messages[1].content;
    expect(context).toContain('objective=First improvement');
  });
  it('rejects cloud models before storing anything', async () => {
    const send = transport();
    await expect(evolveOnce(scoped, { model: 'x:cloud', objective: 'Anything', root, transport: send })).rejects.toThrow('explicit_local_model_required');
    expect(send).not.toHaveBeenCalled();
    expect((await query('SELECT count(*)::int AS n FROM growth_runtime.candidates')).rows[0].n).toBe(0);
  });
});
