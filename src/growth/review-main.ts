import { Pool } from 'pg';
import { listCandidates, reviewCandidate } from './review.js';

// Owner review CLI. Lists candidates or labels one accepted/rejected.
//   npm run growth:review -- --list --db postgres://...
//   npm run growth:review -- --id <uuid> --decision accepted --db postgres://...
const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i]!;
  if (!arg.startsWith('--')) continue;
  const eq = arg.indexOf('=');
  if (eq > 2) { args.set(arg.slice(2, eq), arg.slice(eq + 1)); continue; }
  const next = process.argv[i + 1];
  if (next && !next.startsWith('--')) { args.set(arg.slice(2), next); i++; }
}
const url = args.get('db') ?? process.env.DATABASE_URL;
if (!url || !/^postgres(ql)?:\/\//.test(url)) throw Error('DATABASE_URL_required');
const pool = new Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
try {
  if (args.has('list')) {
    process.stdout.write(JSON.stringify(await listCandidates(pool), null, 2) + '\n');
  } else {
    const id = args.get('id');
    const decision = args.get('decision');
    if (!id || (decision !== 'accepted' && decision !== 'rejected')) throw Error('usage: --list | --id <uuid> --decision accepted|rejected');
    process.stdout.write(JSON.stringify(await reviewCandidate(pool, id, decision as 'accepted' | 'rejected'), null, 2) + '\n');
  }
} finally { await pool.end().catch(() => undefined); }
