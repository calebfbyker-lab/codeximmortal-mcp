import { Pool } from 'pg';
import { swarmOnce } from './swarm.js';

// Local swarm run: up to 4 distinct local models plan the same objective in
// sequence, each seeing prior candidates. Advisory candidates only; the owner
// labels outcomes afterwards with growth:review.
//   set GROWTH_LOCAL_AI=on
//   npm run growth:swarm -- --models llama3:latest,llama3.2:latest --objective "What to improve" --db postgres://...
if (process.env.GROWTH_LOCAL_AI !== 'on') throw Error('GROWTH_LOCAL_AI_not_enabled');
const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i]!;
  if (!arg.startsWith('--')) continue;
  const eq = arg.indexOf('=');
  if (eq > 2) { args.set(arg.slice(2, eq), arg.slice(eq + 1)); continue; }
  const next = process.argv[i + 1];
  if (next && !next.startsWith('--')) { args.set(arg.slice(2), next); i++; }
}
const models = (args.get('models') ?? '').split(',').map(m => m.trim()).filter(Boolean);
const objective = args.get('objective');
if (!objective || !objective.trim()) throw Error('GROWTH_EVOLVE_OBJECTIVE_required');
const url = args.get('db') ?? process.env.DATABASE_URL;
if (!url || !/^postgres(ql)?:\/\//.test(url)) throw Error('DATABASE_URL_required');
const pool = new Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
try {
  const result = await swarmOnce(pool, { models, objective });
  process.stdout.write(JSON.stringify({ status: 'stored_candidates', ...result }, null, 2) + '\n');
} finally { await pool.end().catch(() => undefined); }
