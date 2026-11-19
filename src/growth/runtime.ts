import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { evaluate, roles, type Role } from './agents.js';
export class GrowthRuntime {
 constructor(private readonly pool: Pool) {}
 private async tx<T>(fn:(c:PoolClient)=>Promise<T>):Promise<T> {
  const c=await this.pool.connect();
  try { await c.query('BEGIN'); await c.query("SET LOCAL statement_timeout='5s'"); await c.query("SET LOCAL lock_timeout='3s'"); const result=await fn(c); await c.query('COMMIT'); return result; }
  catch(e) { await c.query('ROLLBACK').catch(()=>undefined); throw e; } finally { c.release(); }
 }
 async enqueue(key:string,role:Role,input:unknown) {
  if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(key)||!roles.includes(role)) throw Error('invalid_request');
  const encoded=JSON.stringify(input);
  if(!encoded||Buffer.byteLength(encoded)>16384) throw Error('invalid_input_size');
  evaluate(role,JSON.parse(encoded));
  return this.tx(async c=>{
   await c.query('SELECT singleton FROM growth_runtime.policy FOR UPDATE');
   const old=await c.query('SELECT id,role,input=$2::jsonb AS same_input FROM growth_runtime.runs WHERE command_key=$1',[key,encoded]);
   if(old.rows[0]) { if(old.rows[0].role!==role||!old.rows[0].same_input) throw Error('command_conflict'); return {id:String(old.rows[0].id)}; }
   const n=await c.query("SELECT count(*)::int AS n FROM growth_runtime.runs WHERE state IN ('queued','running')");
   if(n.rows[0].n>=50) throw Error('capacity_reached');
   const id=randomUUID();
   await c.query('INSERT INTO growth_runtime.runs(id,command_key,role,input) VALUES($1,$2,$3,$4::jsonb)',[id,key,role,encoded]);
   await c.query("INSERT INTO growth_runtime.events(run_id,kind,actor) VALUES($1,'queued','owner')",[id]);
   return {id};
  });
 }
 async claim(worker:string):Promise<{id:string;token:string}|null> {
  if(!/^[a-zA-Z0-9_-]{1,64}$/.test(worker)) throw Error('invalid_worker');
  return this.tx(async c=>{
   const p=await c.query('SELECT paused FROM growth_runtime.policy FOR UPDATE');
   if(p.rows[0]?.paused!==false) return null;
   await c.query("UPDATE growth_runtime.runs SET state='failed',token=NULL,lease_until=NULL WHERE state='running' AND lease_until<=clock_timestamp() AND attempts>=3");
   const r=await c.query("SELECT id FROM growth_runtime.runs WHERE attempts<3 AND (state='queued' OR (state='running' AND lease_until<=clock_timestamp())) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1");
   if(!r.rows[0]) return null;
   const id=String(r.rows[0].id),token=randomUUID();
   await c.query("UPDATE growth_runtime.runs SET state='running',token=$2,worker=$3,lease_until=clock_timestamp()+interval '30 seconds',attempts=attempts+1 WHERE id=$1",[id,token,worker]);
   await c.query("INSERT INTO growth_runtime.events(run_id,kind,actor) VALUES($1,'claimed',$2)",[id,worker]);
   return {id,token};
  });
 }
 async renew(id:string,token:string):Promise<boolean> {
  const r=await this.pool.query("UPDATE growth_runtime.runs SET lease_until=clock_timestamp()+interval '30 seconds' WHERE id=$1 AND token=$2 AND state='running' AND lease_until>clock_timestamp() AND EXISTS(SELECT 1 FROM growth_runtime.policy WHERE paused=false) RETURNING id",[id,token]);
  return r.rowCount===1;
 }
 // Server recomputes from stored input. Verified means deterministic output, NOT verified business truth.
 async complete(id:string,token:string):Promise<boolean> {
  return this.tx(async c=>{
   const p=await c.query('SELECT paused FROM growth_runtime.policy FOR UPDATE');
   if(p.rows[0]?.paused!==false) return false;
   const r=await c.query("SELECT role,input,worker FROM growth_runtime.runs WHERE id=$1 AND token=$2 AND state='running' AND lease_until>clock_timestamp() FOR UPDATE",[id,token]);
   if(!r.rows[0]) return false;
   const output=evaluate(r.rows[0].role as Role,r.rows[0].input);
   const updated=await c.query("UPDATE growth_runtime.runs SET output=$3::jsonb,state='verified',token=NULL,lease_until=NULL WHERE id=$1 AND token=$2 AND lease_until>clock_timestamp() RETURNING id",[id,token,JSON.stringify(output)]);
   if(updated.rowCount!==1) return false;
   await c.query("INSERT INTO growth_runtime.events(run_id,kind,actor) VALUES($1,'proposal_computed',$2)",[id,r.rows[0].worker]);
   return true;
  });
 }
 async list() { return (await this.pool.query('SELECT id,role,state,attempts,output,created_at FROM growth_runtime.runs ORDER BY created_at DESC,id LIMIT 50')).rows; }
}
