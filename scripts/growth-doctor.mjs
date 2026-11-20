import { Pool } from 'pg';

let failed = false;
const report = (name, ok, message) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${message}`);
  if (!ok) failed = true;
};
const url = process.env.DATABASE_URL;
if (!url || /YOUR_REAL_PASSWORD|your-install-password|user:pass@/i.test(url)) {
  report('database', false, 'Set DATABASE_URL to a real dedicated development database URL; do not use example credentials.');
} else {
  let valid = false;
  try { valid = ['postgres:', 'postgresql:'].includes(new URL(url).protocol); } catch {}
  if (!valid) {
    report('database', false, 'DATABASE_URL must be a valid PostgreSQL URL.');
  } else {
    const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 5000, statement_timeout: 5000, options: '-c default_transaction_read_only=on' });
    try {
      await pool.query('SELECT 1');
      report('database', true, 'Connected; no credentials printed.');
      const result = await pool.query("SELECT to_regclass('growth_runtime.runs') AS runs, to_regclass('growth_runtime.candidates') AS candidates");
      const row = result.rows[0];
      report('migration tables', Boolean(row.runs && row.candidates), row.runs && row.candidates ? 'Both target tables exist; schema integrity is not certified by this check.' : 'Missing growth tables; apply migrations only after confirming this is a disposable database.');
    } catch (error) {
      const codes = [error.code, ...(error.errors ?? []).map(item => item.code)];
      const message = codes.includes('28P01')
        ? 'Server reachable, authentication rejected. Use the actual database password; this tool cannot recover or reset it.'
        : codes.includes('ECONNREFUSED')
          ? 'Connection refused at the configured host/port. Check the PostgreSQL service and port.'
          : codes.includes('3D000')
            ? 'Configured database does not exist.'
            : 'Database check failed. Check configuration and server logs; raw errors are withheld to avoid leaking credentials.';
      report('database', false, message);
    } finally { await pool.end().catch(() => undefined); }
  }
}
try {
  const response = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(5000), redirect: 'error' });
  if (!response.ok) throw Error('ollama_http_error');
  const data = await response.json();
  const available = Array.isArray(data.models) && data.models.some(model => model.name === 'llama3:latest');
  report('Ollama', available, available ? 'Loopback server advertises llama3:latest; inference not tested.' : 'Server reachable, but llama3:latest is not advertised.');
} catch {
  report('Ollama', false, 'Cannot read local model inventory at 127.0.0.1:11434. Check the local Ollama server.');
}
console.log('Read-only preflight complete. No migrations, inference, password resets, reviews, or releases performed.');
process.exitCode = failed ? 1 : 0;
