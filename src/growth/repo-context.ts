import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Read-only, allowlisted repository context for local planning.
// Only these paths are ever read; secrets and unrelated files stay out of model input.
const DIR_ALLOWLIST = ['src/growth'];
const FILE_ALLOWLIST = ['docs/growth-runtime.md', 'docs/growth-postgres-verification.md'];

export function collectRepoContext(root: string = process.cwd(), budget = 12000): string {
  const base = resolve(root);
  if (!statSync(base).isDirectory()) throw Error('invalid_repo_root');
  const parts: string[] = [];
  parts.push('Repository facts (read-only, allowlisted):');
  for (const dir of DIR_ALLOWLIST) {
    try {
      const entries = readdirSync(join(base, dir)).filter(name => /\.(ts|sql)$/.test(name)).sort();
      parts.push(`Files in ${dir}:`);
      for (const name of entries) {
        const size = statSync(join(base, dir, name)).size;
        parts.push(`- ${dir}/${name} (${size} bytes)`);
      }
    } catch { parts.push(`Files in ${dir}: [unavailable]`); }
  }
  for (const rel of FILE_ALLOWLIST) {
    parts.push(`--- ${rel} ---`);
    try { parts.push(readFileSync(join(base, rel), 'utf8')); }
    catch { parts.push('[unavailable]'); }
  }
  const out = parts.join('\n');
  if (Buffer.byteLength(out) > budget) return out.slice(0, budget) + '\n[truncated]';
  return out;
}
