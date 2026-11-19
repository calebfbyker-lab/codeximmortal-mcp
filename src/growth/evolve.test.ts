import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { evolveOnce } from './evolve.js';

const url = process.env.TEST_DATABASE_URL;
if (process.env.REQUIRE_DB_TESTS === 'true' && !url) throw new Error('TEST_DATABASE_URL_required');
if (url && process.env.CODEX_DB_TEST_ACK !== 'disposable-database-only') throw new Error('disposable_database_ack_required');
describe.runIf(Boolean(url))('growth evolve loop against disposable PostgreSQL', () => {
  const schema = 'growth_evolve_test_' + randomUUID().replaceAll('-', '');
  const plan = { objective: 'Improve the dashboard', actions: ['Add evidence column'], risks: ['Approval control weakened'] };
  const sql = (text: string) => text.replaceAll('growth_runtime', schema);
  const query = (text: string, values?: unknown[]) => pool!.query(sql(text), values);
  const reply = () => new Response(JSON.stringify({ done: true, message: { content: JSON.stringify(plan) } }));
  let pool: Pool | undefined, root: string;
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 6, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
    // The 007 and 008 migrations create their schema objects; do not pre-create them.
    for (const file of ['007_growth_runtime.sql', '008_growth_candidates.sql'])
      await pool.query(readFileSync(new URL('../../migrations/' + file, import.meta.url), 'utf8').replaceAll('growth_runtime', schema));
    root = mkdtempSync(join(tmpdir(), 'growth-evolve-'));
    mkdirSync(join(root, 'src/growth'), { recursive: true });
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(join(root, 'src/growth/runtime.ts'), 'export const x = 1;\n');
    writeFileSync(join(root, 'docs/growth-runtime.md'), '# Growth\nRuntime doc.\n');
  });
  beforeEach(async () => { await query('TRUNCATE growth_runtime.candidates'); });
  afterAll(async () => {
    if (pool) { try { await pool.query('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE'); } finally { await pool.end(); } }
    rmSync(root, { recursive: true, force: true });
  });
  it('stores a candidate built from repo context', async () => {
    const send = vi.fn(async () => reply());
    const result = await evolveOnce(pool!, { model: 'llama3:latest', objective: 'Improve the dashboard', root, transport: send, includeHistory: false });
    expect(result.duplicate).toBe(false);
    const row = (await query('SELECT model, objective, plan FROM growth_runtime.candidates')).rows[0];
    expect(row).toMatchObject({ model: 'llama3:latest', objective: 'Improve the dashboard' });
    expect(row.plan).toEqual(plan);
    const body = JSON.parse(send.mock.calls[0][1].body as string);
    expect(body.model).toBe('llama3:latest');
    expect(body.messages[1].content).toContain('Improve the dashboard');
    expect(body.messages[1].content).toContain('src/growth');
  });
  it('dedupes identical planning runs without a second row', async () => {
    const send = vi.fn(async () => reply());
    const first = await evolveOnce(pool!, { model: 'llama3:latest', objective: 'Stable objective', root, transport: send, includeHistory: false });
    const second = await evolveOnce(pool!, { model: 'llama3:latest', objective: 'Stable objective', root, transport: send, includeHistory: false });
    expect(second.duplicate).toBe(true);
    expect(second.id).toBe(first.id);
    expect((await query('SELECT count(*)::int AS n FROM growth_runtime.candidates')).rows[0].n).toBe(1);
  });
  it('feeds prior candidates into the next planning context', async () => {
    const send = vi.fn(async () => reply());
    await evolveOnce(pool!, { model: 'llama3:latest', objective: 'First improvement', root, transport: send, includeHistory: false });
    await evolveOnce(pool!, { model: 'llama3:latest', objective: 'Second improvement', root, transport: send });
    const secondContext = JSON.parse(send.mock.calls[1][1].body as string).messages[1].content;
    expect(secondContext).toContain('objective=First improvement');
  });
  it('rejects cloud models before storing anything', async () => {
    const send = vi.fn(async () => reply());
    await expect(evolveOnce(pool!, { model: 'x:cloud', objective: 'Anything', root, transport: send })).rejects.toThrow('explicit_local_model_required');
    expect(send).not.toHaveBeenCalled();
    expect((await query('SELECT count(*)::int AS n FROM growth_runtime.candidates')).rows[0].n).toBe(0);
  });
});
