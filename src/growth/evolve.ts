import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { planLocally } from './local-ai.js';
import { collectRepoContext } from './repo-context.js';

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export interface EvolveOptions {
  model: string;
  objective: string;
  root?: string;
  includeHistory?: boolean;
  transport?: FetchLike;
}

interface CandidateRow { objective: string; status: string; plan: { actions?: string[] } }

export async function listRecentCandidates(pool: Pool, limit = 5): Promise<string[]> {
  const bounded = Math.min(Math.max(Math.trunc(limit) || 0, 1), 20);
  const r = await pool.query('SELECT objective, status, plan FROM growth_runtime.candidates ORDER BY created_at DESC LIMIT $1', [bounded]);
  return (r.rows as CandidateRow[]).map(row => `objective=${row.objective.slice(0, 200)} status=${row.status} actions=${row.plan.actions?.length ?? 0}`);
}

export async function storeCandidate(pool: Pool, model: string, objective: string, contextDigest: string, plan: Record<string, unknown>): Promise<{ id: string; duplicate: boolean }> {
  const id = randomUUID();
  const inserted = await pool.query(
    'INSERT INTO growth_runtime.candidates (id, model, objective, context_digest, plan) VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT (model, objective, context_digest) DO NOTHING RETURNING id',
    [id, model, objective, contextDigest, JSON.stringify(plan)]);
  if (inserted.rows[0]) return { id: String(inserted.rows[0].id), duplicate: false };
  const existing = await pool.query('SELECT id FROM growth_runtime.candidates WHERE model=$1 AND objective=$2 AND context_digest=$3', [model, objective, contextDigest]);
  if (!existing.rows[0]) throw Error('candidate_store_conflict');
  return { id: String(existing.rows[0].id), duplicate: true };
}

// One recursion step: repo facts + prior candidate history -> local model plan
// -> durable candidate. Output remains advisory: nothing here executes, approves,
// integrates or releases anything.
export async function evolveOnce(pool: Pool, options: EvolveOptions): Promise<{ id: string; duplicate: boolean; model: string; objective: string }> {
  if (typeof options?.model !== 'string' || typeof options?.objective !== 'string' || !options.objective.trim() || options.objective.length > 2000) throw Error('invalid_objective');
  const repo = collectRepoContext(options.root);
  const history = options.includeHistory === false ? [] : await listRecentCandidates(pool);
  const sections = [options.objective.trim(), '', history.length ? 'Recent candidate history (for continuity, not authority):' : 'No prior candidates recorded.', ...history, '', 'Repository context:', repo];
  const context = sections.join('\n');
  const plan = await planLocally(options.model, context, options.transport);
  const stored = await storeCandidate(pool, options.model, options.objective.trim(), digest(context), plan as unknown as Record<string, unknown>);
  return { ...stored, model: options.model, objective: options.objective.trim() };
}
