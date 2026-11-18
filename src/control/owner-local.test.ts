import { describe, expect, it } from 'vitest';
import { scryptSync } from 'node:crypto';
import { localOwnerConfig } from './owner-local.js';
function fixture(): NodeJS.ProcessEnv {
  return { CODEX_OWNER_LOCAL_PASSWORD: 'synthetic-local-password-only',
    CODEX_OWNER_LOCAL_REVISION: 'b70babec95c5ac083d3c21617a20f00e8a9d223f',
    CODEX_OWNER_LOCAL_PFX: 'synthetic.pfx', CODEX_OWNER_LOCAL_PFX_PASSWORD: 'synthetic-pfx-password',
    CODEX_OWNER_LOCAL_CA: 'synthetic.pem' };
}
describe('local owner launcher configuration', () => {
  it('requires all local configuration and reports no supplied values', () => {
    for (const key of Object.keys(fixture())) {
      const env = fixture(); delete env[key];
      expect(() => localOwnerConfig(env)).toThrow(/^owner_local_configuration_required$/);
    }
  });
  it('derives a verifier without returning the plaintext owner password', () => {
    const env = fixture(); const result = localOwnerConfig(env);
    expect(result.app.origin).toBe('https://localhost:8443'); expect(result.app.owner).toBe('owner');
    expect(result.app.hashHex).toBe(scryptSync(env.CODEX_OWNER_LOCAL_PASSWORD!, Buffer.from(result.app.saltHex, 'hex'), 64).toString('hex'));
    expect(JSON.stringify(result)).not.toContain(env.CODEX_OWNER_LOCAL_PASSWORD);
  });
  it('rejects weak-length passwords and non-commit revisions', () => {
    expect(() => localOwnerConfig({ ...fixture(), CODEX_OWNER_LOCAL_PASSWORD: 'short' })).toThrow();
    expect(() => localOwnerConfig({ ...fixture(), CODEX_OWNER_LOCAL_REVISION: 'main' })).toThrow();
  });
  it('uses a new salt for each process configuration', () => {
    expect(localOwnerConfig(fixture()).app.saltHex).not.toBe(localOwnerConfig(fixture()).app.saltHex);
  });
});
