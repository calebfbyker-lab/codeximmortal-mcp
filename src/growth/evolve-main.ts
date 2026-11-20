import { Pool } from 'pg';
import { evolveOnce } from './evolve.js';

// Local evolution step: collects allowlisted repo context, includes recent candidate
// history, asks the configured local model for a candidate plan, and stores it for
// owner review. Advisory only; no execution, approval or release. Apply migrations
// 007 and 008 manually before use.
//   GROWTH_LOCAL_AI=on (required gate)
//   npm run growth:evolve -- --model llama3:latest --objective "What to improve" [--db postgres://...]
// Env vars GROWTH_LOCAL_MODEL, GROWTH_EVOLVE_OBJECTIVE and DATABASE_URL still work as fallbacks.
const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i]!;
  if (!arg.startsWith('--')) continue;
  const eq = arg.indexOf('=');
  if (eq > 2) { args.set(arg.slice(2, eq), arg.slice(eq + 1)); continue; }
  const next = process.argv[i + 1];
  if (next && !next.startsWith('--')) { args.set(arg.slice(2), next); i++; }
}
if (process.env.GROWTH_LOCAL_AI !== 'on') throw Error('GROWTH_LOCAL_AI_not_enabled');
const model = args.get('model') ?? process.env.GROWTH_LOCAL_MODEL;
if (!model) throw Error('GROWTH_LOCAL_MODEL_required');
const objective = args.get('objective') ?? process.env.GROWTH_EVOLVE_OBJECTIVE;
if (!objective || !objective.trim()) throw Error('GROWTH_EVOLVE_OBJECTIVE_required');
const url = args.get('db') ?? process.env.DATABASE_URL;
if (!url || !/^postgres(ql)?:\/\//.test(url)) throw Error('DATABASE_URL_required');
const pool = new Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
try {
  const result = await evolveOnce(pool, { model, objective });
  process.stdout.write(JSON.stringify({ status: 'stored_candidate', ...result }, null, 2) + '\n');
} finally { await pool.end().catch(() => undefined); }
