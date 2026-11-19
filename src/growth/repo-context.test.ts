import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collectRepoContext } from './repo-context.js';

describe('repo context collector', () => {
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'growth-ctx-'));
    mkdirSync(join(root, 'src/growth'), { recursive: true });
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(join(root, 'src/growth/one.ts'), 'export const a = 1;\n');
    writeFileSync(join(root, 'src/growth/two.sql'), 'SELECT 1;\n');
    writeFileSync(join(root, 'docs/growth-runtime.md'), '# Growth\nTest doc content\n');
    writeFileSync(join(root, 'secret.env'), 'PASSWORD=1\n');
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  it('lists only allowlisted sources and file contents', () => {
    const ctx = collectRepoContext(root, 4000);
    expect(ctx).toContain('src/growth/one.ts');
    expect(ctx).toContain('src/growth/two.sql');
    expect(ctx).toContain('docs/growth-runtime.md');
    expect(ctx).toContain('Test doc content');
    expect(ctx).not.toContain('secret.env');
    expect(ctx).not.toContain('PASSWORD');
  });
  it('enforces the byte budget with a truncation marker', () => {
    const ctx = collectRepoContext(root, 300);
    expect(Buffer.byteLength(ctx)).toBeLessThanOrEqual(320);
    expect(ctx).toContain('[truncated]');
  });
  it('rejects a missing repository root', () => {
    expect(() => collectRepoContext(join(root, 'does-not-exist'))).toThrow('invalid_repo_root');
  });
});
