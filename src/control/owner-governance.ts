import { Pool, type PoolClient } from 'pg';
import { createHash, randomUUID } from 'node:crypto';

// Owner-control governance and state persistence. Trusted local library with the same
// boundary as owner-task-queue.ts: actor labels are NOT authentication, and producer/
// verifier/admin database-role separation is not implemented. The code floor below is
// authoritative: stored policy documents may only tighten it, never loosen it.
export const OWNER_POLICY_FLOOR = Object.freeze({ maxAttempts: 3, leaseSeconds: 30, maxUnfinished: 50,
  maxResultBytes: 8192, network: false, shell: false, spendCents: 0, modelTokens: 0, subtasks: 0, trainingEligible: false });
export function defaultDispatchPolicyDocument() { return { ...OWNER_POLICY_FLOOR }; }
export function policyFloorViolation(document: Record<string, unknown>): string | null {
  for (const key of ['maxAttempts','leaseSeconds','maxUnfinished','maxResultBytes','subtasks'] as const)
    if (document[key] !== undefined && (typeof document[key] !== 'number' || document[key] > OWNER_POLICY_FLOOR[key])) return key;
  for (const key of ['network','shell','trainingEligible'] as const)
    if (document[key] === true) return key;
  for (const key of ['spendCents','modelTokens'] as const)
    if (typeof document[key] === 'number' && document[key] > OWNER_POLICY_FLOOR[key]) return key;
  return null;
}
class GovernanceError extends Error {}
const canonical = (value: Record<string, unknown>) => JSON.stringify(value, Object.keys(value).sort());
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
function identifier(value: string) { if (!/^[A-Za-z0-9_.@-]{1,100}$/.test(value)) throw new GovernanceError('invalid_identity'); }

export interface OwnerGovernanceView { version: number; document: Record<string, unknown>; documentSha256: string }
export interface OwnerGovernanceAgent { agent_id: string; role: string; last_heartbeat: Date | string; last_task_id: string | null }

export class OwnerGovernance {
  private readonly s: string;
  constructor(private readonly pool: Pool, readonly owner: string, schema = 'owner_control') {
    identifier(owner); if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new GovernanceError('invalid_schema');
    this.s = '"' + schema + '"';
  }
  private async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect().catch(() => { throw new GovernanceError('owner_governance_database_unavailable'); });
    try {
      await c.query('BEGIN'); await c.query("SET LOCAL statement_timeout='5s'"); await c.query("SET LOCAL lock_timeout='3s'");
      const value = await fn(c); await c.query('COMMIT'); return value;
    } catch (error) {
      await c.query('ROLLBACK').catch(() => undefined);
      if (error instanceof GovernanceError) throw error;
      throw new GovernanceError('owner_governance_database_unavailable');
    } finally { c.release(); }
  }
  private async floorCheck(document: Record<string, unknown>) {
    const violation = policyFloorViolation(document);
    if (violation) throw new GovernanceError('policy_floor_violation:' + violation);
  }
  // Seeds version 1 of a policy document idempotently; used by CLI init after migrations.
  async seedInitialPolicy(kind: string, document: Record<string, unknown>): Promise<void> {
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(kind)) throw new GovernanceError('invalid_policy_kind');
    await this.floorCheck(document);
    const encoded = canonical(document);
    await this.tx(async c => {
      await c.query(`INSERT INTO ${this.s}.policy_documents(id,owner_id,kind,version,document_sha256,document)
        VALUES($1,$2,$3,1,$4,$5::jsonb) ON CONFLICT (owner_id,kind,version) DO NOTHING`,
        [randomUUID(), this.owner, kind, sha256(encoded), encoded]);
    });
  }
  // The dispatch policy kind is pinned to version 1 to match the tasks table CHECK
  // (policy_version=1). Publishing further versions requires a reviewed migration plus code change.
  async publishPolicy(kind: string, document: Record<string, unknown>): Promise<OwnerGovernanceView> {
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(kind)) throw new GovernanceError('invalid_policy_kind');
    if (kind === 'owner_task_dispatch') throw new GovernanceError('policy_version_pinned');
    await this.floorCheck(document);
    const encoded = canonical(document);
    return this.tx(async c => {
      const prior = await c.query<{ id: string; version: number }>(
        `SELECT id, version FROM ${this.s}.policy_documents WHERE owner_id=$1 AND kind=$2 AND superseded_by IS NULL FOR UPDATE`, [this.owner, kind]);
      const version = (prior.rows[0]?.version ?? 0) + 1;
      const id = randomUUID();
      await c.query(`INSERT INTO ${this.s}.policy_documents(id,owner_id,kind,version,document_sha256,document) VALUES($1,$2,$3,$4,$5,$6)`,
        [id, this.owner, kind, version, sha256(encoded), encoded]);
      if (prior.rows[0]) await c.query(`UPDATE ${this.s}.policy_documents SET superseded_by=$1 WHERE id=$2`, [id, prior.rows[0].id]);
      return { version, document, documentSha256: sha256(encoded) };
    });
  }
  // Active policy with stored-hash verification; a tampered or missing document fails closed.
  async activePolicy(kind: string): Promise<OwnerGovernanceView> {
    const row = await this.tx(async c => {
      const r = await c.query<{ version: number; document: Record<string, unknown>; document_sha256: string }>(
        `SELECT version, document, document_sha256 FROM ${this.s}.policy_documents
         WHERE owner_id=$1 AND kind=$2 AND superseded_by IS NULL ORDER BY version DESC LIMIT 1`, [this.owner, kind]);
      return r.rows[0];
    });
    if (!row || sha256(canonical(row.document)) !== row.document_sha256) throw new GovernanceError('policy_unavailable_or_tampered');
    return { version: row.version, document: row.document, documentSha256: row.document_sha256 };
  }
  // Approvals are recorded after the queue transition succeeds; task_events remains the
  // transactional source of truth for authorization history.
  async recordApproval(taskId: string, policyKind: string, policyVersion: number, action: string, decision: 'approved' | 'denied'): Promise<void> {
    if (!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(taskId)) throw new GovernanceError('invalid_task_id');
    await this.tx(async c => {
      await c.query(`INSERT INTO ${this.s}.approvals(id,owner_id,task_id,policy_kind,policy_version,action,decision)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (owner_id,task_id,action,policy_version) DO NOTHING`,
        [randomUUID(), this.owner, taskId, policyKind, policyVersion, action, decision]);
    });
  }
  // Append-only hash chain. An advisory lock serializes appends per owner so the chain cannot fork.
  async audit(eventType: string, actor: string, payload: Record<string, unknown> = {}): Promise<void> {
    identifier(actor); if (eventType.length < 1 || eventType.length > 100) throw new GovernanceError('invalid_event');
    const encoded = canonical(payload);
    await this.tx(async c => {
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [this.owner]);
      const last = await c.query<{ entry_sha256: string }>(
        `SELECT entry_sha256 FROM ${this.s}.governance_events WHERE owner_id=$1 ORDER BY sequence DESC LIMIT 1`, [this.owner]);
      const prev = last.rows[0]?.entry_sha256 ?? null;
      const inserted = await c.query<{ sequence: string }>(
        `INSERT INTO ${this.s}.governance_events(owner_id,actor,event_type,payload,prev_entry_sha256) VALUES($1,$2,$3,$4::jsonb,$5) RETURNING sequence`,
        [this.owner, actor, eventType, encoded, prev]);
      const sequence = inserted.rows[0].sequence;
      await c.query(`UPDATE ${this.s}.governance_events SET entry_sha256=$1 WHERE sequence=$2`,
        [sha256([sequence, prev ?? '', this.owner, actor, eventType, encoded].join('|')), sequence]);
    });
  }
  async verifyChain(limit = 100): Promise<boolean> {
    return this.tx(async c => {
      const rows = await c.query<{ sequence: string; actor: string; event_type: string; payload: Record<string, unknown>; prev_entry_sha256: string | null; entry_sha256: string }>(
        `SELECT sequence, actor, event_type, payload, prev_entry_sha256, entry_sha256 FROM ${this.s}.governance_events
         WHERE owner_id=$1 ORDER BY sequence ASC LIMIT $2`, [this.owner, limit]);
      let prev: string | null = null;
      for (const row of rows.rows) {
        const encoded = canonical(row.payload);
        if (row.prev_entry_sha256 !== prev) return false;
        if (row.entry_sha256 !== sha256([row.sequence, prev ?? '', this.owner, row.actor, row.event_type, encoded].join('|'))) return false;
        prev = row.entry_sha256;
      }
      return true;
    });
  }
  async listAgents(): Promise<OwnerGovernanceAgent[]> {
    return this.tx(async c => {
      const r = await c.query<OwnerGovernanceAgent>(
        `SELECT agent_id, role, last_heartbeat, last_task_id FROM ${this.s}.agent_registrations
         WHERE owner_id=$1 ORDER BY last_heartbeat DESC LIMIT 20`, [this.owner]);
      return r.rows;
    });
  }
  // Liveness telemetry only: a heartbeat is not trust, capability, or an identity proof.
  async heartbeat(role: 'worker' | 'verifier', agentId: string, taskId?: string): Promise<void> {
    identifier(agentId);
    await this.tx(async c => {
      await c.query(`INSERT INTO ${this.s}.agent_registrations(owner_id,agent_id,role,last_task_id)
        VALUES($1,$2,$3,$4) ON CONFLICT (owner_id,agent_id)
        DO UPDATE SET last_heartbeat=clock_timestamp(), last_task_id=EXCLUDED.last_task_id`,
        [this.owner, agentId, role, taskId ?? null]);
    });
  }
}
