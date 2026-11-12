import type { Pool, PoolClient } from "pg";
import { randomUUID, createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { ApiError, type Principal, type Service } from "./api.js";
import { executeService, type Providers } from "./worker.js";
export interface Lease {
  id: string; buyerId: string; clientId: string; service: Service;
  input: Record<string, unknown>; authorized: boolean; token: string; attempt: number; maxAttempts: number;
}
type Outcome = { ok: true; value: unknown } | { ok: false; code: "provider_rejected" | "retry_exhausted" };
export class DurableWorker {
  private readonly s: string;
  constructor(private readonly pool: Pool, private readonly providers: Providers, schema="agent_commerce", private readonly leaseSeconds=60) {
    if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema) || !Number.isInteger(leaseSeconds) || leaseSeconds<15 || leaseSeconds>900) throw new Error("invalid_worker_configuration");
    this.s=`"${schema}"`;
  }
  private async tx<T>(fn:(c:PoolClient)=>Promise<T>):Promise<T> {
    const c=await this.pool.connect().catch(()=>{throw new ApiError(503,"worker_database_unavailable");});
    try {
      await c.query("BEGIN"); await c.query("SET LOCAL statement_timeout='5000ms'"); await c.query("SET LOCAL lock_timeout='3000ms'");
      const value=await fn(c); await c.query("COMMIT"); return value;
    } catch(e) {await c.query("ROLLBACK").catch(()=>undefined); if(e instanceof ApiError)throw e; throw new ApiError(503,"worker_database_unavailable");}
    finally {c.release();}
  }
  private async locks(c:PoolClient,l:Pick<Lease,"id"|"buyerId"|"clientId">) {
    // Same accounting lock order as admission; lease is never held during provider IO.
    const b=await c.query(`SELECT active FROM ${this.s}.buyers WHERE id=$1 FOR UPDATE`,[l.buyerId]);
    const d=await c.query(`SELECT *,expires_at>clock_timestamp() AS live_grant FROM ${this.s}.delegations WHERE buyer_id=$1 AND client_id=$2 FOR UPDATE`,[l.buyerId,l.clientId]);
    const j=await c.query(`SELECT * FROM ${this.s}.jobs WHERE id=$1 AND buyer_id=$2 AND client_id=$3 FOR UPDATE`,[l.id,l.buyerId,l.clientId]);
    const o=await c.query(`SELECT *,lease_until>clock_timestamp() AS live FROM ${this.s}.outbox WHERE job_id=$1 FOR UPDATE`,[l.id]);
    if(b.rowCount!==1||d.rowCount!==1||j.rowCount!==1||o.rowCount!==1)throw new ApiError(503,"worker_invariant_failed");
    return {job:j.rows[0],outbox:o.rows[0],buyer:b.rows[0],delegation:d.rows[0]};
  }
  async claim():Promise<Lease|null> {
    return this.tx(async c=>{
      // Lock buyer first, never outbox first: avoids inversion with admission/finalization.
      const r=await c.query(`SELECT j.id,j.buyer_id AS "buyerId",j.client_id AS "clientId" FROM ${this.s}.outbox o JOIN ${this.s}.jobs j ON j.id=o.job_id JOIN ${this.s}.buyers b ON b.id=j.buyer_id WHERE o.delivered_at IS NULL AND o.available_at<=clock_timestamp() AND (o.lease_until IS NULL OR o.lease_until<=clock_timestamp()) AND j.status IN ('queued','running') ORDER BY o.created_at,j.id LIMIT 1 FOR UPDATE OF b SKIP LOCKED`);
      if(!r.rowCount)return null;
      const candidate=r.rows[0],{job,outbox,buyer,delegation}=await this.locks(c,candidate);
      if(outbox.delivered_at||outbox.live||!["queued","running"].includes(job.status))return null;
      const token=randomUUID();
      const lease=await c.query(`UPDATE ${this.s}.outbox SET lease_token=$2,lease_until=clock_timestamp()+($3::int*interval '1 second'),attempts=attempts+1 WHERE job_id=$1 RETURNING attempts,max_attempts`,[job.id,token,this.leaseSeconds]);
      await c.query(`UPDATE ${this.s}.jobs SET status='running' WHERE id=$1`,[job.id]);
      return {id:job.id,buyerId:job.buyer_id,clientId:job.client_id,service:job.service,input:job.input,authorized:buyer.active&&delegation.active&&delegation.live_grant&&delegation.scopes.includes("services:execute")&&delegation.services.includes(job.service),token,attempt:lease.rows[0].attempts,maxAttempts:lease.rows[0].max_attempts};
    });
  }
  async renew(l:Lease):Promise<boolean> {
    return this.tx(async c=>{
      const r=await c.query(`UPDATE ${this.s}.outbox SET lease_until=clock_timestamp()+($3::int*interval '1 second') WHERE job_id=$1 AND lease_token=$2 AND lease_until>clock_timestamp() AND delivered_at IS NULL RETURNING job_id`,[l.id,l.token,this.leaseSeconds]);
      return r.rowCount===1;
    });
  }
  async defer(l:Lease):Promise<string> {
    return this.tx(async c=>{
      const {job,outbox}=await this.locks(c,l);
      if(outbox.lease_token!==l.token||!outbox.live||job.status!=="running"||outbox.attempts>=outbox.max_attempts)return "stale";
      await c.query(`UPDATE ${this.s}.jobs SET status='queued' WHERE id=$1`,[l.id]);
      await c.query(`UPDATE ${this.s}.outbox SET lease_token=NULL,lease_until=NULL,available_at=clock_timestamp()+($2::int*interval '1 second') WHERE job_id=$1`,[l.id,Math.min(300,5*Math.pow(2,outbox.attempts-1))]);
      return "retry_scheduled";
    });
  }
  async finish(l:Lease,outcome:Outcome):Promise<string> {
    let encoded:string|undefined,hash:string|undefined;
    if(outcome.ok) {
      try {encoded=JSON.stringify(outcome.value);if(encoded===undefined||Buffer.byteLength(encoded)>1048576)throw new Error();hash=createHash("sha256").update(encoded).digest("hex");}
      catch {throw new ApiError(502,"invalid_provider_output");}
    }
    return this.tx(async c=>{
      const {job,outbox}=await this.locks(c,l);
      if(["succeeded","failed"].includes(job.status))return "already_finalized";
      if(outbox.lease_token!==l.token||!outbox.live||job.status!=="running")return "stale";
      const h=await c.query(`SELECT * FROM ${this.s}.reservations WHERE job_id=$1 FOR UPDATE`,[l.id]);
      if(h.rowCount!==1||h.rows[0].state!=="held"||h.rows[0].amount_minor!==job.amount_minor)throw new ApiError(503,"worker_invariant_failed");
      const amount=job.amount_minor,status=outcome.ok?"succeeded":"failed",receipt=randomUUID();
      const wallet=await c.query(`UPDATE ${this.s}.wallets SET held_minor=held_minor-$2,available_minor=available_minor+$3 WHERE buyer_id=$1 AND held_minor>=$2 RETURNING buyer_id`,[l.buyerId,amount,outcome.ok?0:amount]);
      const budget=await c.query(`UPDATE ${this.s}.delegations SET reserved_minor=reserved_minor-$3,spent_minor=spent_minor+$4 WHERE buyer_id=$1 AND client_id=$2 AND reserved_minor>=$3 RETURNING buyer_id`,[l.buyerId,l.clientId,amount,outcome.ok?amount:0]);
      if(wallet.rowCount!==1||budget.rowCount!==1)throw new ApiError(503,"worker_invariant_failed");
      await c.query(`INSERT INTO ${this.s}.receipts(id,job_id,outcome,amount_minor,currency,charged_minor,error_code,result_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[receipt,l.id,status,amount,job.currency,outcome.ok?amount:0,outcome.ok?null:outcome.code,hash??null]);
      if(outcome.ok)await c.query(`INSERT INTO ${this.s}.results(job_id,value,receipt_id) VALUES($1,$2::jsonb,$3)`,[l.id,encoded,receipt]);
      await c.query(`INSERT INTO ${this.s}.ledger(buyer_id,job_id,kind,available_delta,held_delta) VALUES($1,$2,$3,$4,-$5::bigint)`,[l.buyerId,l.id,outcome.ok?"consume":"release",outcome.ok?0:amount,amount]);
      await c.query(`UPDATE ${this.s}.reservations SET state=$2 WHERE job_id=$1`,[l.id,outcome.ok?"consumed":"released"]);
      await c.query(`UPDATE ${this.s}.jobs SET status=$2 WHERE id=$1`,[l.id,status]);
      await c.query(`UPDATE ${this.s}.outbox SET delivered_at=clock_timestamp(),lease_token=NULL,lease_until=NULL WHERE job_id=$1`,[l.id]);
      return status;
    });
  }
  async runOnce():Promise<string> {
    const l=await this.claim();if(!l)return "idle";
    if(!l.authorized)return this.finish(l,{ok:false,code:"provider_rejected"});
    if(l.attempt>l.maxAttempts)return this.finish(l,{ok:false,code:"retry_exhausted"});
    const controller=new AbortController();let lost=false,pending:Promise<void>|undefined;
    const heartbeat=setInterval(()=>{if(pending)return;pending=this.renew(l).then(ok=>{if(!ok){lost=true;controller.abort();}}).catch(()=>{lost=true;controller.abort();}).finally(()=>{pending=undefined;});},Math.floor(this.leaseSeconds*1000/3));
    let timer:ReturnType<typeof setTimeout>|undefined,value:unknown,error:unknown,failed=false;
    const p:Principal={buyerId:l.buyerId,clientId:l.clientId,scopes:["services:execute"]};
    try {
      value=await Promise.race([executeService(this.providers,p,l.service,l.input,{jobId:l.id,attempt:l.attempt,signal:controller.signal}),new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new ApiError(504,"provider_timeout"));},Math.min(30000,this.leaseSeconds*500));})]);
    } catch(e){failed=true;error=e;}
    finally {if(timer)clearTimeout(timer);clearInterval(heartbeat);await pending;}
    if(lost)return "stale";
    if(!failed) {
      try{return await this.finish(l,{ok:true,value});}
      catch(e){if(!(e instanceof ApiError&&e.code==="invalid_provider_output"))throw e;failed=true;error=e;}
    }
    const terminal=error instanceof ApiError&&([400,403,404,415,422].includes(error.status)||(error.status===502&&error.code==="invalid_provider_output"));
    if(terminal||l.attempt>=l.maxAttempts)return this.finish(l,{ok:false,code:terminal?"provider_rejected":"retry_exhausted"});
    return this.defer(l);
  }
  async run(signal:AbortSignal):Promise<void> {
    while(!signal.aborted){
      try{await this.runOnce();}catch{console.error(JSON.stringify({event:"commerce_worker_iteration_failed"}));}
      await delay(1000,undefined,{signal}).catch(()=>undefined);
    }
  }
}
