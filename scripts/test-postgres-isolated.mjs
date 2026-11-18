import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const name = 'codex-test-' + randomUUID();
const password = randomBytes(24).toString('hex');
function docker(args, allowFailure = false) {
  const result = spawnSync('docker', args, { encoding: 'utf8', cwd });
  if (!allowFailure && (result.error || result.status !== 0)) throw new Error('Docker command failed: ' + args[0]);
  return result;
}
let created = false;
try {
  docker(['run', '--detach', '--name', name, '--publish', '127.0.0.1::5432', '--env', 'POSTGRES_USER=codex_test', '--env', 'POSTGRES_DB=codex_disposable_test', '--env', 'POSTGRES_PASSWORD=' + password, '--tmpfs', '/var/lib/postgresql/data:rw', 'postgres:16']);
  created = true;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (docker(['exec', name, 'pg_isready', '-U', 'codex_test', '-d', 'codex_disposable_test'], true).status === 0) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!ready) throw new Error('Disposable PostgreSQL readiness timeout');
  const published = docker(['port', name, '5432/tcp']).stdout.trim();
  const match = /^127\.0\.0\.1:(\d+)$/.exec(published);
  if (!match) throw new Error('Unexpected Docker loopback binding');
  const url = 'postgresql://codex_test:' + password + '@127.0.0.1:' + match[1] + '/codex_disposable_test';
  const env = { ...process.env, DATABASE_URL: url, TEST_DATABASE_URL: url, REQUIRE_DB_TESTS: 'true', CODEX_DB_TEST_ACK: 'disposable-database-only', TZ: 'UTC' };
  const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run'], { cwd, env, stdio: 'inherit' });
  process.exitCode = result.error ? 1 : (result.status ?? 1);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (created && docker(['rm', '--force', '--volumes', name], true).status !== 0) {
    console.error('Cleanup failed for disposable container ' + name);
    process.exitCode = 1;
  }
}
