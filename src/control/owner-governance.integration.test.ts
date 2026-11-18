import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OwnerGovernance, defaultDispatchPolicyDocument } from './owner-governance.js';
const url = process.env.TEST_DATABASE_URL;
if (process.env.REQUIRE_DB_TESTS === 'true' && !url) throw new Error('TEST_DATABASE_URL_required');
if (url && process.env.CODEX_DB_TEST_ACK !== 'disposable-database-only') throw new Error('disposable_database_ack_required');
describe.runIf(Boolean(url))('owner governance against disposable PostgreSQL', () => {
  const schema = 'owner_test_' + randomUUID().replaceAll('-', '');
  let pool: Pool | undefined, governance: OwnerGovernance, owner: string;
  let created = false;
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 6, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
    await pool.query('CREATE SCHEMA "' + schema + '"'); created = true;
    for (const file of ['003_owner_tasks.sql', '004_owner_governance.sql'])
      await pool.query(readFileSync(new URL('../../migrations/' + file, import.meta.url), 'utf8').replaceAll('owner_control', schema));
  });
  beforeEach(async () => {
    owner = 'owner-' + randomUUID();
    await pool!.query('INSERT INTO "' + schema + '".dispatch_policy(owner_id) VALUES($1)', [owner]);
    governance = new OwnerGovernance(pool!, owner, schema);
  });
  afterAll(async () => { if (pool) { try { if (created) await pool.query('DROP SCHEMA "' + schema + '" CASCADE'); } finally { await pool.end(); } } });
  it('seeds the initial policy idempotently and verifies it', async () => {
    await governance.seedInitialPolicy('owner_task_dispatch', defaultDispatchPolicyDocument());
    await governance.seedInitialPolicy('owner_task_dispatch', defaultDispatchPolicyDocument());
    const policy = await governance.activePolicy('owner_task_dispatch');
    expect(policy.version).toBe(1);
    expect(policy.document).toEqual(defaultDispatchPolicyDocument());
  });
  it('rejects loosening documents and pins the dispatch policy version', async () => {
    await expect(governance.seedInitialPolicy('owner_task_dispatch', { ...defaultDispatchPolicyDocument(), maxAttempts: 4 })).rejects.toThrow('policy_floor_violation:maxAttempts');
    await expect(governance.publishPolicy('owner_task_dispatch', defaultDispatchPolicyDocument())).rejects.toThrow('policy_version_pinned');
  });
  it('fails closed when the stored document no longer matches its hash', async () => {
    await governance.seedInitialPolicy('owner_task_dispatch', defaultDispatchPolicyDocument());
    await pool!.query("UPDATE \"" + schema + "\".policy_documents SET document = $2::jsonb WHERE owner_id=$1 AND kind='owner_task_dispatch'", [owner, '{"maxUnfinished":49}']);
    await expect(governance.activePolicy('owner_task_dispatch')).rejects.toThrow('policy_unavailable_or_tampered');
  });
  it('versions and supersedes publishable policy kinds', async () => {
    const first = await governance.publishPolicy('future_kind', { maxAttempts: 2 });
    expect(first.version).toBe(1);
    const second = await governance.publishPolicy('future_kind', { maxAttempts: 1 });
    expect(second.version).toBe(2);
    expect((await governance.activePolicy('future_kind')).version).toBe(2);
  });
  it('appends a verifiable hash chain without forking under concurrency', async () => {
    await Promise.all(Array.from({ length: 5 }, () => governance.audit('test_event', 'owner')));
    expect(await governance.verifyChain(100)).toBe(true);
    await pool!.query("UPDATE \"" + schema + "\".governance_events SET event_type='forged' WHERE owner_id=$1", [owner]);
    expect(await governance.verifyChain(100)).toBe(false);
  });
  it('records idempotent approvals and agent heartbeats', async () => {
    const key = randomUUID();
    await pool!.query("INSERT INTO \"" + schema + "\".tasks(id,owner_id,command_key,objective,baseline_revision) VALUES($1,$2,$3,'label','a881179873ec9f81eaa02c3bea3f8b31c9e49c4f')", [key, owner, randomUUID()]);
    await governance.recordApproval(key, 'owner_task_dispatch', 1, 'task_approve', 'approved');
    await governance.recordApproval(key, 'owner_task_dispatch', 1, 'task_approve', 'approved');
    const count = await pool!.query('SELECT count(*)::int AS n FROM "' + schema + '".approvals WHERE owner_id=$1', [owner]);
    expect(count.rows[0].n).toBe(1);
    await governance.heartbeat('worker', 'registry-observer', key);
    await governance.heartbeat('worker', 'registry-observer');
    const agents = await governance.listAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0].role).toBe('worker');
    expect(agents[0].last_task_id).toBeNull();
  });
});
