import type { Pool } from 'pg';

// Owner outcome labeling. Only the owner transitions a candidate out of
// unreviewed; agents never review their own or peers' output. One-shot:
// a candidate cannot be re-labeled once accepted or rejected.
export type Decision = 'accepted' | 'rejected';

export async function reviewCandidate(pool: Pool, id: string, decision: Decision): Promise<{ id: string; status: string }> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw Error('invalid_candidate_id');
  if (decision !== 'accepted' && decision !== 'rejected') throw Error('invalid_decision');
  const r = await pool.query(
    "UPDATE growth_runtime.candidates SET status=$1 WHERE id=$2::uuid AND status='unreviewed' RETURNING id, status",
    [decision, id]);
  if (!r.rows[0]) throw Error('candidate_not_unreviewed');
  return { id: String(r.rows[0].id), status: String(r.rows[0].status) };
}

export async function listCandidates(pool: Pool, limit = 20): Promise<{ id: string; model: string; objective: string; status: string; createdAt: string }[]> {
  const bounded = Math.min(Math.max(Math.trunc(limit) || 0, 1), 100);
  const r = await pool.query('SELECT id, model, objective, status, created_at FROM growth_runtime.candidates ORDER BY created_at DESC LIMIT $1', [bounded]);
  return (r.rows as { id: string; model: string; objective: string; status: string; created_at: Date }[])
    .map(row => ({ id: String(row.id), model: row.model, objective: row.objective, status: row.status, createdAt: row.created_at.toISOString() }));
}
