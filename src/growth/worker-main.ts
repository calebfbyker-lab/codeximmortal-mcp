import { Pool } from 'pg';
import { GrowthRuntime } from './runtime.js';
import { GrowthWorker } from './worker.js';

// Local proposal-processing daemon. Runs entirely on this machine against the
// owner's PostgreSQL. No shell, git, network or hosted CI in this increment.
// Enablement requires explicit opt-in so the process never starts by accident:
//   $env:DATABASE_URL='postgres://...'
//   $env:GROWTH_WORKER='on'
//   npm run growth:worker
// Optional: GROWTH_WORKER_NAME, GROWTH_WORKER_POLL_MS (milliseconds, 100..60000).
const url = process.env.DATABASE_URL;
if (!url || !/^postgres(ql)?:\/\//.test(url)) throw new Error('DATABASE_URL_required');
if (process.env.GROWTH_WORKER !== 'on') throw new Error('GROWTH_WORKER_not_enabled');
const pool = new Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
const worker = new GrowthWorker(new GrowthRuntime(pool), {
  name: process.env.GROWTH_WORKER_NAME ?? 'local-worker',
  pollMs: Number(process.env.GROWTH_WORKER_POLL_MS ?? 2000),
});
let stopping = false;
const shutdown = () => { if (!stopping) { stopping = true; worker.stop(); } };
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
try { await worker.run(); }
finally { await pool.end().catch(() => undefined); }
