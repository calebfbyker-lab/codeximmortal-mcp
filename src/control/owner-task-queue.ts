import { Pool, type PoolClient } from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { proposedServices } from '../agent-services/registry.js';
import { OwnerGovernance, defaultDispatchPolicyDocument } from './owner-governance.js';

export const OWNER_TASK_POLICY = Object.freeze({ version: 1, kind: 'service_registry_report',
  maxAttempts: 3, leaseSeconds: 30, maxUnfinished: 50, maxResultBytes: 8192,
  network: false, shell: false, spendCents: 0, modelTokens: 0, subtasks: 0, trainingEligible: false });
export interface OwnerTask { id: string; owner_id: string; objective: string; baseline_revision: string;
  state: string; attempts: number; lease_token: string | null; worker_id: string | null; result: unknown }
export type OwnerClaim = OwnerTask & { lease_token: string };
export interface OwnerTaskRecord { id: string; command_key: string; objective: string; baseline_revision: string;
  state: string; attempts: number; worker_id: string | null; verifier_id: string | null; error_code: string | null;
  result: unknown; created_at: Date | string }
export interface OwnerTaskEventRecord { sequence: number | string; task_id: string | null; event_type: string; actor: string; created_at: Date | string }
export interface OwnerTaskView { paused: boolean; policy: typeof OWNER_TASK_POLICY; tasks: OwnerTaskRecord[]; events: OwnerTaskEventRecord[] }
class TaskError extends Error {}
function identifier(value: string) { if (!/^[A-Za-z0-9_.@-]{1,100}$/.test(value)) throw new TaskError('invalid_identity'); }
function uuid(value: string) { if (!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)) throw new TaskError('invalid_task_id'); }
function revision(value: string) { if (!/^[a-f0-9]{40}$/.test(value)) throw new TaskError('invalid_baseline'); }
export function registryReport(baselineRevision: string) {
  revision(baselineRevision);
  return { kind: OWNER_TASK_POLICY.kind, baselineRevision,
    registryDigest: createHash('sha256').update(JSON.stringify(proposedServices)).digest('hex'), services: proposedServices };
}
export function verifyRegistryReport(value: unknown, baseline: string) {
  return isDeepStrictEqual(value, registryReport(baseline));
}
// Trusted internal library. Actor labels are NOT authentication. Never expose directly as agent tools.
export class OwnerTaskQueue {
  private readonly s: string;
  constructor(private readonly pool: Pool, readonly owner: string, schema='owner_control') {
    identifier(owner); if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new TaskError('invalid_schema');
    this.s = '"' + schema + '"';
  }
  private async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect().catch(() => { throw new TaskError('owner_task_database_unavailable'); });
    try {
      await c.query('BEGIN'); await c.query("SET LOCAL statement_timeout='5s'"); await c.query("SET LOCAL lock_timeout='3s'");
      const value = await fn(c); await c.query('COMMIT'); return value;
    } catch (error) {
      await c.query('ROLLBACK').catch(() => undefined);
      if (error instanceof TaskError) throw error;
      throw new TaskError('owner_task_database_unavailable');
    } finally { c.release(); }
  }
  private async event(c: PoolClient, id: string | null, type: string, actor: string) {
    await c.query(`INSERT INTO ${this.s}.task_events(owner_id,task_id,event_type,actor) VALUES($1,$2,$3,$4)`, [this.owner,id,type,actor]);
  }
  private async policy(c: PoolClient) {
    const result = await c.query(`SELECT paused FROM ${this.s}.dispatch_policy WHERE owner_id=$1 FOR UPDATE`, [this.owner]);
    if (!result.rows[0]) throw new TaskError('owner_task_not_initialized');
    return result.rows[0] as { paused: boolean };
  }
  async initialize() {
    await this.tx(c => c.query(`INSERT INTO ${this.s}.dispatch_policy(owner_id) VALUES($1) ON CONFLICT DO NOTHING`, [this.owner]));
  }
  async propose(key: string, objective: string, baseline: string): Promise<OwnerTask> {
    uuid(key); revision(baseline);
    if (typeof objective !== 'string' || objective.trim().length<1 || objective.length>400) throw new TaskError('invalid_objective');
    objective = objective.trim();
    return this.tx(async c => {
      await this.policy(c);
      const existing = await c.query<OwnerTask>(`SELECT * FROM ${this.s}.tasks WHERE owner_id=$1 AND command_key=$2`, [this.owner,key]);
      if (existing.rows[0]) {
        if (existing.rows[0].objective!==objective || existing.rows[0].baseline_revision!==baseline) throw new TaskError('command_conflict');
        return existing.rows[0];
      }
      const count = await c.query(`SELECT count(*)::int AS n FROM ${this.s}.tasks WHERE owner_id=$1 AND state IN ('proposed','queued','running','awaiting_verification')`, [this.owner]);
      if (count.rows[0].n>=OWNER_TASK_POLICY.maxUnfinished) throw new TaskError('task_capacity_reached');
      const inserted = await c.query<OwnerTask>(`INSERT INTO ${this.s}.tasks(id,owner_id,command_key,objective,baseline_revision) VALUES($1,$2,$3,$4,$5) RETURNING *`, [randomUUID(),this.owner,key,objective,baseline]);
      await this.event(c,inserted.rows[0].id,'proposed',this.owner); return inserted.rows[0];
    });
  }
  async approve(id: string) {
    uuid(id);
    await this.tx(async c => {
      await this.policy(c);
      const r = await c.query(`UPDATE ${this.s}.tasks SET state='queued' WHERE id=$1 AND owner_id=$2 AND state='proposed' RETURNING id`, [id,this.owner]);
      if (!r.rowCount) throw new TaskError('task_transition_denied');
      await this.event(c,id,'owner_authorized_policy_v1',this.owner);
    });
  }
  async pause(paused: boolean) {
    if (typeof paused!=='boolean') throw new TaskError('invalid_pause');
    await this.tx(async c => {
      const previous = await this.policy(c);
      if (previous.paused===paused) return;
      await c.query(`UPDATE ${this.s}.dispatch_policy SET paused=$2 WHERE owner_id=$1`, [this.owner,paused]);
      await this.event(c,null,paused?'dispatch_paused':'dispatch_resumed',this.owner);
    });
  }
  async claim(worker: string): Promise<OwnerClaim | null> {
    identifier(worker);
    return this.tx(async c => {
      if ((await this.policy(c)).paused) return null;
      const exhausted = await c.query<{id:string}>(`UPDATE ${this.s}.tasks SET state='failed',lease_until=NULL,lease_token=NULL,error_code='attempt_budget_exhausted' WHERE owner_id=$1 AND state='running' AND lease_until<=clock_timestamp() AND attempts>=3 RETURNING id`, [this.owner]);
      for (const row of exhausted.rows) await this.event(c,row.id,'attempt_budget_exhausted',worker);
      const next = await c.query<OwnerTask>(`SELECT * FROM ${this.s}.tasks WHERE owner_id=$1 AND attempts<3 AND (state='queued' OR (state='running' AND lease_until<=clock_timestamp())) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1`, [this.owner]);
      if (!next.rows[0]) return null;
      const token = randomUUID();
      const r = await c.query<OwnerTask>(`UPDATE ${this.s}.tasks SET state='running',worker_id=$2,lease_token=$3,lease_until=clock_timestamp()+interval '30 seconds',attempts=attempts+1 WHERE id=$1 RETURNING *`, [next.rows[0].id,worker,token]);
      await this.event(c,r.rows[0].id,'claimed',worker); return { ...r.rows[0],lease_token:token };
    });
  }
  async submit(claim: OwnerClaim, value: unknown) {
    const encoded = JSON.stringify(value);
    if (!encoded || Buffer.byteLength(encoded)>OWNER_TASK_POLICY.maxResultBytes) throw new TaskError('invalid_task_result');
    await this.tx(async c => {
      await this.policy(c);
      const r = await c.query(`UPDATE ${this.s}.tasks SET state='awaiting_verification',result=$5::jsonb,lease_until=NULL,lease_token=NULL WHERE id=$1 AND owner_id=$2 AND lease_token=$3 AND worker_id=$4 AND state='running' AND lease_until>clock_timestamp() RETURNING id`, [claim.id,this.owner,claim.lease_token,claim.worker_id,encoded]);
      if (!r.rowCount) throw new TaskError('stale_or_cancelled_claim');
      await this.event(c,claim.id,'submitted_unverified',claim.worker_id!);
    });
  }
  async verify(id: string, verifier: string, baseline: string): Promise<boolean> {
    uuid(id); identifier(verifier); revision(baseline);
    return this.tx(async c => {
      await this.policy(c);
      const r = await c.query<OwnerTask>(`SELECT * FROM ${this.s}.tasks WHERE id=$1 AND owner_id=$2 FOR UPDATE`, [id,this.owner]);
      const row = r.rows[0];
      if (!row || row.state!=='awaiting_verification' || row.worker_id===verifier) throw new TaskError('verification_denied');
      const passed = row.baseline_revision===baseline && verifyRegistryReport(row.result,baseline);
      await c.query(`UPDATE ${this.s}.tasks SET state=$3,verifier_id=$4,error_code=$5 WHERE id=$1 AND owner_id=$2`, [id,this.owner,passed?'verified':'rejected',verifier,passed?null:'baseline_or_report_mismatch']);
      await this.event(c,id,passed?'verified':'verification_rejected',verifier); return passed;
    });
  }
  async cancel(id: string) {
    uuid(id);
    await this.tx(async c => {
      await this.policy(c);
      const r = await c.query(`UPDATE ${this.s}.tasks SET state='cancelled',lease_token=NULL,lease_until=NULL WHERE id=$1 AND owner_id=$2 AND state IN ('proposed','queued','running','awaiting_verification') RETURNING id`, [id,this.owner]);
      if (!r.rowCount) throw new TaskError('task_transition_denied');
      await this.event(c,id,'cancelled',this.owner);
    });
  }
  async pendingVerification(): Promise<OwnerTask[]> {
    return this.tx(async c => {
      await this.policy(c);
      const r = await c.query<OwnerTask>(`SELECT * FROM ${this.s}.tasks WHERE owner_id=$1 AND state='awaiting_verification' ORDER BY created_at,id LIMIT 20`, [this.owner]);
      return r.rows;
    });
  }
  async view(): Promise<OwnerTaskView> {
    return this.tx(async c => {
      const policy = await this.policy(c);
      const tasks = await c.query<OwnerTaskRecord>(`SELECT id,command_key,objective,baseline_revision,state,attempts,worker_id,verifier_id,error_code,result,created_at FROM ${this.s}.tasks WHERE owner_id=$1 ORDER BY created_at DESC,id DESC LIMIT 50`, [this.owner]);
      const events = await c.query<OwnerTaskEventRecord>(`SELECT sequence,task_id,event_type,actor,created_at FROM ${this.s}.task_events WHERE owner_id=$1 ORDER BY sequence DESC LIMIT 100`, [this.owner]);
      return { paused: policy.paused, policy: OWNER_TASK_POLICY, tasks: tasks.rows, events: events.rows };
    });
  }
}
// Shared local-only task-database configuration for the CLI and the local dashboard launcher.
export function localOwnerTaskPool(env: NodeJS.ProcessEnv): Pool | undefined {
  const raw = env.CODEX_OWNER_TASK_DATABASE_URL;
  if (!raw) return undefined;
  if (env.CODEX_OWNER_TASK_DB_ACK!=='local-owner-tasks-only') throw new TaskError('local_task_database_configuration_required');
  const url = new URL(raw);
  if (!['postgres:','postgresql:'].includes(url.protocol) || !['localhost','127.0.0.1','[::1]'].includes(url.hostname) || url.pathname!=='/codex_owner_control' || url.search || url.hash) throw new TaskError('dedicated_local_task_database_required');
  return new Pool({ connectionString:raw,max:4,connectionTimeoutMillis:5000,statement_timeout:10000 });
}
// Local CLI only; no public route or automatic migration. Passwords stay in local secret configuration.
async function cli() {
  const pool = localOwnerTaskPool(process.env);
  if (!pool) throw new TaskError('local_task_database_configuration_required');
  try {
    const mode = process.argv[2];
    if (mode==='init' || mode==='init-governance') {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        for (const file of mode==='init' ? ['003_owner_tasks.sql','004_owner_governance.sql'] : ['004_owner_governance.sql'])
          await c.query(readFileSync(new URL('../../migrations/'+file,import.meta.url),'utf8'));
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
    }
    const queue = new OwnerTaskQueue(pool,'owner'); await queue.initialize();
    if (mode==='init' || mode==='init-governance') {
      await new OwnerGovernance(pool,'owner').seedInitialPolicy('owner_task_dispatch', defaultDispatchPolicyDocument());
      console.log(mode==='init' ? 'Owner task and governance schema initialized; dispatch is paused by default.' : 'Owner governance schema initialized; dispatch state is unchanged.');
    }
    const baseline = () => {
      const value = execFileSync('git',['rev-parse','HEAD'],{ encoding:'utf8',timeout:5000,maxBuffer:8192 }).trim();
      revision(value); return value;
    };
    if (mode==='propose') console.log(JSON.stringify(await queue.propose(process.env.CODEX_OWNER_TASK_COMMAND_KEY ?? randomUUID(),process.argv.slice(3).join(' '),baseline())));
    else if (mode==='approve') await queue.approve(process.argv[3] ?? '');
    else if (mode==='cancel') await queue.cancel(process.argv[3] ?? '');
    else if (mode==='pause' || mode==='resume') await queue.pause(mode==='pause');
    else if (mode==='list') console.log(JSON.stringify(await queue.view(),null,2));
    else if (mode==='worker' || mode==='verifier' || mode==='run-once') {
      const governance = new OwnerGovernance(pool,'owner');
      const controller = new AbortController();
      process.once('SIGINT',()=>controller.abort()); process.once('SIGTERM',()=>controller.abort());
      do {
        const current = baseline();
        if (mode==='verifier') {
          await governance.heartbeat('verifier','registry-verifier').catch(()=>undefined);
          for (const task of await queue.pendingVerification()) await queue.verify(task.id,'registry-verifier',current);
        } else {
          const task = await queue.claim('registry-observer');
          await governance.heartbeat('worker','registry-observer',task?.id).catch(()=>undefined);
          if (task) { await queue.submit(task,registryReport(current)); console.log(JSON.stringify({event:'owner_task_submitted',taskId:task.id})); }
        }
        if (mode==='run-once') break;
        await delay(1000,undefined,{signal:controller.signal}).catch(()=>undefined);
      } while (!controller.signal.aborted);
    } else throw new TaskError('unknown_owner_task_command');
  } finally { await pool.end(); }
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href===import.meta.url) {
  void cli().catch(()=>{ console.error('Owner task operation failed. Check local configuration, migration, task state and baseline; do not print credentials.'); process.exitCode=1; });
}
