import type { Pool } from 'pg';
import { evolveOnce, type FetchLike } from './evolve.js';

export interface SwarmOptions {
  models: string[];
  objective: string;
  root?: string;
  transport?: FetchLike;
}

// Multi-agent planning over one objective. Agents run sequentially; each later
// agent's planning context includes every stored candidate (model-attributed,
// with owner-labeled status), so peers build on peers through shared memory.
// Every output is an advisory candidate: nothing executes, approves or releases.
// Learning is history-conditioning, not weight training.
export async function swarmOnce(pool: Pool, options: SwarmOptions): Promise<{ stored: { id: string; duplicate: boolean; model: string; objective: string }[] }> {
  const models = [...new Set((options.models ?? []).map(m => typeof m === 'string' ? m.trim() : ''))].filter(Boolean);
  if (models.length < 1 || models.length > 4) throw Error('invalid_models_1_to_4');
  const stored: { id: string; duplicate: boolean; model: string; objective: string }[] = [];
  for (const model of models) {
    const result = await evolveOnce(pool, { model, objective: options.objective, root: options.root, transport: options.transport });
    stored.push({ id: result.id, duplicate: result.duplicate, model: result.model, objective: result.objective });
  }
  return { stored };
}
