import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GrowthRuntime } from './runtime.js';
import { evaluate } from './agents.js';

const url=process.env.TEST_DATABASE_URL;
if(process.env.REQUIRE_DB_TESTS==='true'&&!url) throw Error('TEST_DATABASE_URL_required');
if(url) {
 let valid=false;
 try {
  const u=new URL(url);
  valid=['postgres:','postgresql:'].includes(u.protocol)&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)&&u.pathname==='/codex_test_disposable'&&!u.search&&!u.hash;
 } catch {}
 if(!valid||process.env.CODEX_DB_TEST_ACK!=='disposable-database-only') throw Error('local_disposable_database_required');
}

describe.runIf(Boolean(url))('growth runtime real PostgreSQL invariants',()=>{
 const schema='growth_test_'+randomUUID().replaceAll('-','');
 let pool:Pool, runtime:GrowthRuntime;
 const input={entered:40,completed:10,cohort:'synthetic-cohort',transition:'quote-to-order'};
 const sql=(text:string)=>text.replaceAll('growth_runtime',schema);
 const query=(text:string,values?:unknown[])=>pool.query(sql(text),values);
 beforeAll(async()=>{
  pool=new Pool({connectionString:url,max:8,connectionTimeoutMillis:5000,statement_timeout:10000});
  const c=await pool.connect();
  try { await c.query(sql(readFileSync(new URL('../../migrations/007_growth_runtime.sql',import.meta.url),'utf8'))); }
  catch(e) { await c.query('ROLLBACK').catch(()=>undefined); throw e; } finally { c.release(); }
  // Routing adapter only: real connections, SQL, transactions and locks.
  // Never touches the shared growth_runtime schema or commerce tables.
  const isolated={
   query,
   connect:async()=>{
    const client=await pool.connect();
    return {query:(text:string,values?:unknown[])=>client.query(sql(text),values),release:()=>client.release()};
   },
  } as unknown as Pool;
  runtime=new GrowthRuntime(isolated);
 },30000);
 afterAll(async()=>{
  if(pool) { try { await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); } finally { await pool.end(); } }
 },30000);
 beforeEach(async()=>{
  await query('TRUNCATE growth_runtime.events,growth_runtime.runs');
  await query('DELETE FROM growth_runtime.policy');
  await query('INSERT INTO growth_runtime.policy(singleton) VALUES(true)');
 });
 const enqueue=()=>runtime.enqueue(randomUUID(),'conversion',input);
 const resume=()=>query('UPDATE growth_runtime.policy SET paused=false');
 async function claim(worker='test-worker') { const c=await runtime.claim(worker); expect(c).not.toBeNull(); return c!; }
 const expire=(id:string)=>query("UPDATE growth_runtime.runs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[id]);
 async function row(id:string) { return (await query('SELECT state,attempts,token,lease_until,output FROM growth_runtime.runs WHERE id=$1',[id])).rows[0]; }
 async function events(id:string,kind:string) { return (await query('SELECT count(*)::int AS n FROM growth_runtime.events WHERE run_id=$1 AND kind=$2',[id,kind])).rows[0].n; }

 it('migration defaults to paused dispatch without consuming an attempt',async()=>{
  const j=await enqueue(); expect(await runtime.claim('worker')).toBeNull();
  expect(await row(j.id)).toMatchObject({state:'queued',attempts:0,token:null,output:null});
 });
 it('missing policy fails closed for claims',async()=>{
  await enqueue(); await query('DELETE FROM growth_runtime.policy');
  expect(await runtime.claim('worker')).toBeNull();
 });
 it('concurrent identical commands create one run and one queued event',async()=>{
  const key=randomUUID();
  const results=await Promise.all(Array.from({length:8},()=>runtime.enqueue(key,'conversion',input)));
  expect(new Set(results.map(r=>r.id)).size).toBe(1);
  expect((await query('SELECT count(*)::int AS n FROM growth_runtime.runs')).rows[0].n).toBe(1);
  expect(await events(results[0].id,'queued')).toBe(1);
 });
 it('rejects idempotency conflicts for changed input or role',async()=>{
  const key=randomUUID(),j=await runtime.enqueue(key,'conversion',input);
  await expect(runtime.enqueue(key,'conversion',{...input,completed:11})).rejects.toThrow('command_conflict');
  await expect(runtime.enqueue(key,'code_evolution',{occurrences:2})).rejects.toThrow('command_conflict');
  expect((await row(j.id)).state).toBe('queued'); expect(await events(j.id,'queued')).toBe(1);
 });
 it('concurrent claimers cannot obtain the same live lease',async()=>{
  const j=await enqueue(); await resume();
  const leases=await Promise.all(Array.from({length:8},(_,i)=>runtime.claim('worker-'+i)));
  expect(leases.filter(Boolean)).toHaveLength(1); expect(leases.find(Boolean)?.id).toBe(j.id);
  expect((await row(j.id)).attempts).toBe(1); expect(await events(j.id,'claimed')).toBe(1);
 });
 it('renews a live owned lease and rejects an unrelated token',async()=>{
  await enqueue(); await resume(); const c=await claim();
  await query("UPDATE growth_runtime.runs SET lease_until=clock_timestamp()+interval '10 seconds' WHERE id=$1",[c.id]);
  const before=(await row(c.id)).lease_until as Date;
  expect(await runtime.renew(c.id,randomUUID())).toBe(false);
  expect(await runtime.renew(c.id,c.token)).toBe(true);
  expect(((await row(c.id)).lease_until as Date).getTime()).toBeGreaterThan(before.getTime());
 });
 it('fences expired and replaced owners from renewal and completion',async()=>{
  await enqueue(); await resume(); const old=await claim(); await expire(old.id);
  expect(await runtime.renew(old.id,old.token)).toBe(false); expect(await runtime.complete(old.id,old.token)).toBe(false);
  const next=await claim('replacement'); expect(next.id).toBe(old.id); expect(next.token).not.toBe(old.token);
  expect(await runtime.renew(old.id,old.token)).toBe(false); expect(await runtime.complete(old.id,old.token)).toBe(false);
  expect(await runtime.complete(next.id,next.token)).toBe(true); expect(await events(next.id,'proposal_computed')).toBe(1);
 });
 it('paused dispatch blocks claim renewal and completion until resumed',async()=>{
  await enqueue(); await resume(); const c=await claim();
  await query('UPDATE growth_runtime.policy SET paused=true');
  expect(await runtime.claim('other')).toBeNull(); expect(await runtime.renew(c.id,c.token)).toBe(false);
  expect(await runtime.complete(c.id,c.token)).toBe(false); expect((await row(c.id)).state).toBe('running');
  await resume(); expect(await runtime.complete(c.id,c.token)).toBe(true);
 });
 it('exhausts three crashed attempts without a fourth claim or completion event',async()=>{
  const j=await enqueue(); await resume();
  for(let i=0;i<3;i++) { const c=await claim('crashed-'+i); expect(c.id).toBe(j.id); await expire(c.id); }
  expect(await runtime.claim('fourth')).toBeNull();
  expect(await row(j.id)).toMatchObject({state:'failed',attempts:3,token:null,lease_until:null,output:null});
  expect(await events(j.id,'claimed')).toBe(3); expect(await events(j.id,'proposal_computed')).toBe(0);
 });
 it('completes once with the stored-input output and exactly one completion event',async()=>{
  await enqueue(); await resume(); const c=await claim();
  expect(await runtime.complete(c.id,c.token)).toBe(true); expect(await runtime.complete(c.id,c.token)).toBe(false);
  expect(await row(c.id)).toMatchObject({state:'verified',token:null,lease_until:null,output:evaluate('conversion',input)});
  expect(await events(c.id,'proposal_computed')).toBe(1);
 });
 it('event-write failure rolls back output state and lease removal before a safe retry',async()=>{
  await enqueue(); await resume(); const c=await claim();
  await query(`CREATE FUNCTION growth_runtime.reject_completion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic completion failure'; END $$;
   CREATE TRIGGER reject_completion BEFORE INSERT ON growth_runtime.events FOR EACH ROW WHEN (NEW.kind='proposal_computed') EXECUTE FUNCTION growth_runtime.reject_completion()`);
  try {
   await expect(runtime.complete(c.id,c.token)).rejects.toThrow('synthetic completion failure');
   expect(await row(c.id)).toMatchObject({state:'running',token:c.token,output:null});
   expect(await events(c.id,'proposal_computed')).toBe(0);
  } finally { await query('DROP TRIGGER reject_completion ON growth_runtime.events; DROP FUNCTION growth_runtime.reject_completion()'); }
  expect(await runtime.complete(c.id,c.token)).toBe(true); expect(await events(c.id,'proposal_computed')).toBe(1);
 });
});
