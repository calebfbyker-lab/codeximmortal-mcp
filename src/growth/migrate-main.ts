import { readFileSync } from 'node:fs';
import { Pool } from 'pg';

// Applies the growth-runtime migrations (007, 008) to a disposable PostgreSQL
// database through the pg driver, so the owner does not need psql on PATH.
// Each migration is skipped when its target table already exists.
//   set CODEX_MIGRATE_ACK=disposable-database-only
//   npm run growth:migrate -- --db postgres://user:pass@localhost:5432/disposable_db
// Acknowledgment env var matches the integration-test convention; nothing runs
// without it. This runner creates tables only; it drops nothing and drops no data.
const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i]!;
  if (!arg.startsWith('--')) continue;
  const eq = arg.indexOf('=');
  if (eq > 2) { args.set(arg.slice(2, eq), arg.slice(eq + 1)); continue; }
  const next = process.argv[i + 1];
  if (next && !next.startsWith('--')) { args.set(arg.slice(2), next); i++; }
}
if (process.env.CODEX_MIGRATE_ACK !== 'disposable-database-only') throw Error('disposable_database_ack_required');
const url = args.get('db') ?? process.env.DATABASE_URL;
if (!url || !/^postgres(ql)?:\/\//.test(url)) throw Error('DATABASE_URL_required');
const MIGRATIONS = [
  { file: '007_growth_runtime.sql', table: 'growth_runtime.runs' },
  { file: '008_growth_candidates.sql', table: 'growth_runtime.candidates' },
];
const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 5000, statement_timeout: 30000 });
try {
  for (const migration of MIGRATIONS) {
    const existing = await pool.query('SELECT to_regclass($1) AS oid', [migration.table]);
    if (existing.rows[0]?.oid) { process.stdout.write(`skipped ${migration.file} (already applied)\n`); continue; }
    const sql = readFileSync(new URL('../../migrations/' + migration.file, import.meta.url), 'utf8');
    await pool.query(sql);
    process.stdout.write(`applied ${migration.file}\n`);
  }
  process.stdout.write('growth_runtime schema ready\n');
} finally { await pool.end().catch(() => undefined); }
