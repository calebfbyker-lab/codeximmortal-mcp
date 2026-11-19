import { Pool } from 'pg';
import { evolveOnce } from './evolve.js';

// Local evolution step: collects allowlisted repo context, includes recent candidate
// history, asks the configured local model for a candidate plan, and stores it for
// owner review. Advisory only; no execution, approval or release. Apply migrations
// 007 and 008 manually before use.
//   $env:DATABASE_URL='postgres://...'
//   $env:GROWTH_LOCAL_AI='on'
//   $env:GROWTH_LOCAL_MODEL='llama3:latest'
//   $env:GROWTH_EVOLVE_OBJECTIVE='What to improve and why'
//   npm run growth:evolve
if (process.env.GROWTH_LOCAL_AI !== 'on') throw Error('GROWTH_LOCAL_AI_not_enabled');
const model = process.env.GROWTH_LOCAL_MODEL;
if (!model) throw Error('GROWTH_LOCAL_MODEL_required');
const objective = process.env.GROWTH_EVOLVE_OBJECTIVE;
if (!objective || !objective.trim()) throw Error('GROWTH_EVOLVE_OBJECTIVE_required');
const url = process.env.DATABASE_URL;
if (!url || !/^postgres(ql)?:\/\//.test(url)) throw Error('DATABASE_URL_required');
const pool = new Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
try {
  const result = await evolveOnce(pool, { model, objective });
  process.stdout.write(JSON.stringify({ status: 'stored_candidate', ...result }, null, 2) + '\n');
} finally { await pool.end().catch(() => undefined); }
