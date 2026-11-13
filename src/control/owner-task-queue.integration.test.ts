import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OwnerTaskQueue, registryReport, verifyRegistryReport } from './owner-task-queue.js';
const baseline = 'a881179873ec9f81eaa02c3bea3f8b31c9e49c4f';
it('verifies registry contents independently of JSON object key ordering',()=>{
  const r=registryReport(baseline);
  expect(verifyRegistryReport(r,baseline)).toBe(true);
  expect(verifyRegistryReport({ services:r.services.map(s=>({registered:s.registered,price:s.price,certification:s.certification,status:s.status,tool:s.tool})),
    registryDigest:r.registryDigest,baselineRevision:baseline,kind:r.kind },baseline)).toBe(true);
  expect(verifyRegistryReport({success:true},baseline)).toBe(false);
});
const url = process.env.TEST_DATABASE_URL;
if (process.env.REQUIRE_DB_TESTS==='true' && !url) throw new Error('TEST_DATABASE_URL_required');
if (url && process.env.CODEX_DB_TEST_ACK!=='disposable-database-only') throw new Error('disposable_database_ack_required');
describe.runIf(Boolean(url))('owner queue against disposable PostgreSQL',()=>{
  const schema = 'owner_test_' + randomUUID().replaceAll('-','');
  let pool: Pool | undefined, queue: OwnerTaskQueue, owner: string;
  let created = false;
  beforeAll(async()=>{
    pool = new Pool({connectionString:url,max:6,connectionTimeoutMillis:5000,statement_timeout:10000});
    await pool.query('CREATE SCHEMA "'+schema+'"'); created=true;
    const sql = readFileSync(new URL('../../migrations/003_owner_tasks.sql',import.meta.url),'utf8').replaceAll('owner_control',schema);
    await pool.query(sql);
  });
  beforeEach(async()=>{owner='owner-'+randomUUID();queue=new OwnerTaskQueue(pool!,owner,schema);await queue.initialize();});
  afterAll(async()=>{if(pool){try{if(created)await pool.query('DROP SCHEMA "'+schema+'" CASCADE');}finally{await pool.end();}}});
  const propose = ()=>queue.propose(randomUUID(),'Inspect the committed service registry',baseline);
  async function ready(){const task=await propose();await queue.approve(task.id);await queue.pause(false);return task;}
  it('defaults paused and does not dispatch unapproved tasks',async()=>{
    await propose();expect((await queue.view()).paused).toBe(true);expect(await queue.claim('worker')).toBeNull();
    await queue.pause(false);expect(await queue.claim('worker')).toBeNull();
  });
  it('deduplicates concurrent creation and rejects changed retry input',async()=>{
    const key=randomUUID();const rows=await Promise.all([queue.propose(key,'same',baseline),queue.propose(key,'same',baseline)]);
    expect(rows[0].id).toBe(rows[1].id);expect((await queue.view()).events).toHaveLength(1);
    await expect(queue.propose(key,'changed',baseline)).rejects.toThrow('command_conflict');
  });
  it('allows only one concurrent claim',async()=>{await ready();expect((await Promise.all([queue.claim('a'),queue.claim('b')])).filter(Boolean)).toHaveLength(1);});
  it('requires a distinct verifier and preserves durable history through JSONB storage',async()=>{
    const task=await ready();const claim=(await queue.claim('observer'))!;await queue.submit(claim,registryReport(baseline));
    await expect(queue.verify(task.id,'observer',baseline)).rejects.toThrow('verification_denied');
    expect(await queue.verify(task.id,'verifier',baseline)).toBe(true);
    const restored=new OwnerTaskQueue(pool!,owner,schema);const view=await restored.view();
    expect(view.tasks[0].state).toBe('verified');
    expect(view.events.map(e=>e.event_type)).toContain('submitted_unverified');
  });
  it('rejects fabricated results and mismatched baselines',async()=>{
    const task=await ready();await queue.submit((await queue.claim('observer'))!,{success:true});
    expect(await queue.verify(task.id,'verifier',baseline)).toBe(false);expect((await queue.view()).tasks[0].state).toBe('rejected');
    const next=await ready();await queue.submit((await queue.claim('observer'))!,registryReport(baseline));
    expect(await queue.verify(next.id,'verifier','b'.repeat(40))).toBe(false);
  });
  it('fences stale workers after expiration and reclaim',async()=>{
    const task=await ready();const old=(await queue.claim('old'))!;
    await pool!.query('UPDATE "'+schema+'".tasks SET lease_until=clock_timestamp()-interval \'1 second\' WHERE id=$1',[task.id]);
    const fresh=(await queue.claim('fresh'))!;expect(fresh.lease_token).not.toBe(old.lease_token);
    await expect(queue.submit(old,registryReport(baseline))).rejects.toThrow('stale_or_cancelled_claim');
    await queue.submit(fresh,registryReport(baseline));
  });
  it('pauses new dispatch but lets accepted work submit',async()=>{
    await ready();const task=(await queue.claim('worker'))!;await queue.pause(true);
    expect(await queue.claim('other')).toBeNull();await queue.submit(task,registryReport(baseline));
  });
  it('cancels running work without accepting its late result',async()=>{
    const task=await ready();const claim=(await queue.claim('worker'))!;await queue.cancel(task.id);
    await expect(queue.submit(claim,registryReport(baseline))).rejects.toThrow('stale_or_cancelled_claim');
  });
  it('enforces the three-attempt budget',async()=>{
    const task=await ready();for(let i=0;i<3;i++){expect(await queue.claim('worker')).not.toBeNull();
      await pool!.query('UPDATE "'+schema+'".tasks SET lease_until=clock_timestamp()-interval \'1 second\' WHERE id=$1',[task.id]);}
    expect(await queue.claim('worker')).toBeNull();expect((await queue.view()).tasks[0].state).toBe('failed');
  });
  it('isolates owners and retains pause across queue reconstruction',async()=>{
    const task=await propose();const other=new OwnerTaskQueue(pool!,'other-'+randomUUID(),schema);await other.initialize();
    expect((await other.view()).tasks).toHaveLength(0);await expect(other.approve(task.id)).rejects.toThrow('task_transition_denied');
    await queue.pause(false);expect((await new OwnerTaskQueue(pool!,owner,schema).view()).paused).toBe(false);
  });
  it('finds old unverified work even when the latest-50 view excludes it',async()=>{
    const task=await ready();await queue.submit((await queue.claim('observer'))!,registryReport(baseline));
    const ids=Array.from({length:51},()=>randomUUID());
    await pool!.query('INSERT INTO "'+schema+'".tasks(id,owner_id,command_key,objective,baseline_revision,state,created_at) SELECT id,$2,id,\'history fixture\',$3,\'cancelled\',clock_timestamp()+interval \'1 second\' FROM unnest($1::uuid[]) AS t(id)',[ids,owner,baseline]);
    expect((await queue.view()).tasks.some(t=>t.id===task.id)).toBe(false);
    expect((await queue.pendingVerification()).map(t=>t.id)).toContain(task.id);
    expect(await queue.verify(task.id,'verifier',baseline)).toBe(true);
  });
});
