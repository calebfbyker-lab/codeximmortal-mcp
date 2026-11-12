import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll,beforeAll,beforeEach,describe,expect,it,vi } from "vitest";
import { ApiError,digest,type Principal,type Service } from "./api.js";
import { PostgresCommerce } from "./postgres-commerce.js";
import { DurableWorker,type Lease } from "./durable-worker.js";
import type { Providers } from "./worker.js";
const url=process.env.TEST_DATABASE_URL;
if(process.env.REQUIRE_DB_TESTS==="true"&&!url)throw new Error("TEST_DATABASE_URL_required");
if(url&&process.env.CODEX_DB_TEST_ACK!=="disposable-database-only")throw new Error("disposable_database_ack_required");
describe.runIf(Boolean(url))("durable execution and settlement",()=>{
  const schema=`worker_test_${randomUUID().replaceAll("-","")}`,buyer=randomUUID();
  const p:Principal={buyerId:buyer,clientId:"agent",scopes:["commerce:quote","services:execute","jobs:read","results:read"]};
  let pool:Pool,backend:PostgresCommerce,worker:DurableWorker,providers:Providers,created=false;
  function snapshot(id="captured",amount=10){return {id,sourceUrl:"https://example.test/pricing",capturedAt:"2026-11-12T13:00:00.000Z",coverage:"partial",plans:[{id:"basic",name:"Basic",amount,currency:"USD",interval:"month",evidence:{text:String(amount),token:String(amount)}}]};}
  beforeAll(async()=>{
    pool=new Pool({connectionString:url,max:10,connectionTimeoutMillis:5000,statement_timeout:10000});
    const c=await pool.connect();
    try{
      await c.query(readFileSync(new URL("../../migrations/standalone_commerce_v1.sql",import.meta.url),"utf8").replaceAll("agent_commerce",schema));created=true;
      await c.query(readFileSync(new URL("../../migrations/standalone_commerce_worker_v1.sql",import.meta.url),"utf8").replaceAll("agent_commerce",schema));
    }catch(e){await c.query("ROLLBACK").catch(()=>undefined);throw e;}finally{c.release();}
    backend=new PostgresCommerce(pool,schema);
  },30000);
  afterAll(async()=>{if(pool){try{if(created)await pool.query(`DROP SCHEMA "${schema}" CASCADE`);}finally{await pool.end();}}},30000);
  beforeEach(async()=>{
    await pool.query(`TRUNCATE ${schema}.buyers,${schema}.prices CASCADE`);
    await pool.query(`INSERT INTO ${schema}.buyers VALUES($1,'https://issuer.example.test','buyer',true,'USD')`,[buyer]);
    await pool.query(`INSERT INTO ${schema}.delegations(buyer_id,client_id,active,expires_at,scopes,services,limit_minor,max_open_jobs) VALUES($1,'agent',true,clock_timestamp()+interval '1 hour',$2,$3,1000,10)`,[buyer,p.scopes,["pricing_snapshot","pricing_compare","document_extract"]]);
    await pool.query(`INSERT INTO ${schema}.wallets(buyer_id,available_minor) VALUES($1,500)`,[buyer]);
    await pool.query(`INSERT INTO ${schema}.ledger(buyer_id,kind,available_delta,held_delta,external_ref) VALUES($1,'fund',500,0,'synthetic-funding')`,[buyer]);
    for(const [kind,id]of [["source","s"],["snapshot","before"],["snapshot","after"],["document","doc"]])await pool.query(`INSERT INTO ${schema}.resources VALUES($1,$2,$3,true)`,[buyer,kind,id]);
    for(const service of ["pricing_snapshot","pricing_compare","document_extract"])await pool.query(`INSERT INTO ${schema}.prices VALUES($1,'synthetic','USD',100,true)`,[service]);
    providers={capture:vi.fn(async()=>snapshot()),snapshot:vi.fn(async(_p:Principal,id:string)=>({value:snapshot(id,id==="before"?10:20),completeTrusted:false})),extract:vi.fn(async()=>({profile:"scalar-fields-v1",pageCount:1,fields:[{name:"name",value:null,page:1,evidence:null}]}))};
    worker=new DurableWorker(pool,providers,schema);
  });
  async function enqueue(service:Service="pricing_snapshot",input:Record<string,unknown>={sourceId:"s"}){
    const q=await backend.quote(p,service,input),v={service,input,quoteId:q.id};
    return backend.submit(p,{...v,idempotencyKey:randomUUID(),digest:digest(v)});
  }
  async function lease(){const l=await worker.claim();expect(l).not.toBeNull();return l!;}
  async function expire(l:Lease){await pool.query(`UPDATE ${schema}.outbox SET lease_until=clock_timestamp()-interval '1 second',available_at=clock_timestamp()-interval '1 second' WHERE job_id=$1`,[l.id]);}
  async function accounting(){return (await pool.query(`SELECT w.available_minor,w.held_minor,d.reserved_minor,d.spent_minor,(SELECT count(*)::int FROM ${schema}.receipts) AS receipts,(SELECT count(*)::int FROM ${schema}.results) AS results FROM ${schema}.wallets w JOIN ${schema}.delegations d USING(buyer_id) WHERE w.buyer_id=$1`,[buyer])).rows[0];}
  it("concurrent claimers cannot lease the same job",async()=>{await enqueue();const leases=await Promise.all([worker.claim(),worker.claim()]);expect(leases.filter(Boolean)).toHaveLength(1);});
  it("executes snapshot and atomically consumes one reservation",async()=>{
    const j=await enqueue();expect(await worker.runOnce()).toBe("succeeded");
    expect(await accounting()).toEqual({available_minor:"400",held_minor:"0",reserved_minor:"0",spent_minor:"100",receipts:1,results:1});
    expect((await backend.result(p,j.id))?.value.id).toBe("captured");
    const args=vi.mocked(providers.capture).mock.calls[0];expect(args[0].buyerId).toBe(buyer);expect(args[2]?.jobId).toBe(j.id);
    expect(await worker.runOnce()).toBe("idle");
  });
  it("runs comparison through existing adapter",async()=>{await enqueue("pricing_compare",{beforeId:"before",afterId:"after"});expect(await worker.runOnce()).toBe("succeeded");expect(providers.snapshot).toHaveBeenCalledTimes(2);});
  it("runs document validation through existing adapter",async()=>{await enqueue("document_extract",{documentId:"doc",profile:"scalar-fields-v1",fields:["name"]});expect(await worker.runOnce()).toBe("succeeded");});
  it("duplicate completion cannot double-consume or duplicate receipt",async()=>{await enqueue();const l=await lease();expect(await worker.finish(l,{ok:true,value:snapshot()})).toBe("succeeded");expect(await worker.finish(l,{ok:true,value:snapshot()})).toBe("already_finalized");expect((await accounting()).spent_minor).toBe("100");expect((await accounting()).receipts).toBe(1);});
  it("expired owner cannot renew or settle after re-lease",async()=>{
    await enqueue();const old=await lease();await expire(old);expect(await worker.renew(old)).toBe(false);const next=await lease();expect(next.token).not.toBe(old.token);
    expect(await worker.finish(old,{ok:true,value:snapshot()})).toBe("stale");expect(await worker.finish(next,{ok:true,value:snapshot()})).toBe("succeeded");
  });
  it("heartbeat renews the owned live lease",async()=>{await enqueue();const l=await lease();expect(await worker.renew(l)).toBe(true);expect(await worker.finish(l,{ok:true,value:snapshot()})).toBe("succeeded");});
  it("malformed provider output releases capacity with failure receipt",async()=>{
    providers.capture=vi.fn(async()=>({invalid:"not-a-snapshot"}));await enqueue();expect(await worker.runOnce()).toBe("failed");
    expect(await accounting()).toEqual({available_minor:"500",held_minor:"0",reserved_minor:"0",spent_minor:"0",receipts:1,results:0});
    expect((await pool.query(`SELECT error_code,charged_minor FROM ${schema}.receipts`)).rows[0]).toEqual({error_code:"provider_rejected",charged_minor:0});
  });
  it("transient failure schedules retry without releasing hold",async()=>{
    providers.capture=vi.fn().mockRejectedValueOnce(new Error("private-provider-detail")).mockResolvedValue(snapshot());
    await enqueue();expect(await worker.runOnce()).toBe("retry_scheduled");expect((await accounting()).held_minor).toBe("100");expect((await accounting()).receipts).toBe(0);expect(await worker.runOnce()).toBe("idle");
    await pool.query(`UPDATE ${schema}.outbox SET available_at=clock_timestamp()-interval '1 second'`);expect(await worker.runOnce()).toBe("succeeded");
  });
  it("retry exhaustion releases exactly once",async()=>{
    providers.capture=vi.fn(async()=>{throw new ApiError(503,"provider_unavailable");});await enqueue();await pool.query(`UPDATE ${schema}.outbox SET max_attempts=1`);
    expect(await worker.runOnce()).toBe("failed");expect((await accounting()).available_minor).toBe("500");expect((await pool.query(`SELECT error_code FROM ${schema}.receipts`)).rows[0].error_code).toBe("retry_exhausted");expect(await worker.runOnce()).toBe("idle");
  });
  it("recovers exhausted crash lease without another provider call",async()=>{
    await enqueue();await pool.query(`UPDATE ${schema}.outbox SET max_attempts=1`);const crashed=await lease();await expire(crashed);
    expect(await worker.runOnce()).toBe("failed");expect(providers.capture).not.toHaveBeenCalled();expect((await accounting()).available_minor).toBe("500");
  });
  it("revocation before execution cancels accepted job and releases hold",async()=>{
    await enqueue();await pool.query(`UPDATE ${schema}.delegations SET active=false WHERE buyer_id=$1`,[buyer]);expect(await worker.runOnce()).toBe("failed");expect(providers.capture).not.toHaveBeenCalled();expect((await accounting()).available_minor).toBe("500");
  });
  it("final outbox-write failure rolls back result, receipt and accounting",async()=>{
    await enqueue();const l=await lease();await pool.query(`CREATE FUNCTION ${schema}.reject_final() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END $$; CREATE TRIGGER reject_final BEFORE UPDATE ON ${schema}.outbox FOR EACH ROW WHEN (NEW.delivered_at IS NOT NULL) EXECUTE FUNCTION ${schema}.reject_final()`);
    try{await expect(worker.finish(l,{ok:true,value:snapshot()})).rejects.toMatchObject({code:"worker_database_unavailable"});expect(await accounting()).toEqual({available_minor:"400",held_minor:"100",reserved_minor:"100",spent_minor:"0",receipts:0,results:0});}
    finally{await pool.query(`DROP TRIGGER reject_final ON ${schema}.outbox; DROP FUNCTION ${schema}.reject_final()`);}
    expect(await worker.finish(l,{ok:true,value:snapshot()})).toBe("succeeded");
  });
  it("result is not visible before successful settlement",async()=>{const j=await enqueue();expect(await backend.result(p,j.id)).toBeNull();await worker.runOnce();expect(await backend.result(p,j.id)).not.toBeNull();});
});
