import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll,beforeAll,beforeEach,describe,expect,it } from "vitest";
import { digest, type Principal, type Service } from "./api.js";
import { PostgresCommerce } from "./postgres-commerce.js";
const url=process.env.TEST_DATABASE_URL;
if(process.env.REQUIRE_DB_TESTS==="true"&&!url) throw new Error("TEST_DATABASE_URL_required");
if(url&&process.env.CODEX_DB_TEST_ACK!=="disposable-database-only") throw new Error("disposable_database_ack_required");
describe.runIf(Boolean(url))("standalone PostgreSQL commerce admission",()=>{
  const schema=`commerce_test_${randomUUID().replaceAll("-","")}`;
  const a=randomUUID(),b=randomUUID(),issuer="https://issuer.example.test";
  const scopes=["commerce:quote","services:execute","jobs:read","results:read"];
  const p: Principal={buyerId:a,clientId:"agent",scopes};
  let pool: Pool,backend: PostgresCommerce,created=false;
  beforeAll(async()=>{
    pool=new Pool({connectionString:url,max:10,connectionTimeoutMillis:5000,statement_timeout:10000});
    const sql=readFileSync(new URL("../../migrations/standalone_commerce_v1.sql",import.meta.url),"utf8").replaceAll("agent_commerce",schema);
    const c=await pool.connect();
    try {await c.query(sql);created=true;} catch(e){await c.query("ROLLBACK").catch(()=>undefined);throw e;} finally{c.release();}
    backend=new PostgresCommerce(pool,schema);
  },30000);
  afterAll(async()=>{if(pool){try{if(created)await pool.query(`DROP SCHEMA "${schema}" CASCADE`);}finally{await pool.end();}}},30000);
  beforeEach(async()=>{
    await pool.query(`TRUNCATE ${schema}.buyers,${schema}.prices CASCADE`);
    for(const [id,subject] of [[a,"alice"],[b,"bob"]]){
      await pool.query(`INSERT INTO ${schema}.buyers(id,issuer,subject,active,currency) VALUES($1,$2,$3,true,'USD')`,[id,issuer,subject]);
      await pool.query(`INSERT INTO ${schema}.delegations(buyer_id,client_id,active,expires_at,scopes,services,limit_minor,max_open_jobs) VALUES($1,'agent',true,clock_timestamp()+interval '1 hour',$2,$3,1000,10)`,[id,scopes,["pricing_snapshot","pricing_compare","document_extract"]]);
      // Synthetic funding only, never a production grant API.
      await pool.query(`INSERT INTO ${schema}.wallets(buyer_id,available_minor) VALUES($1,200)`,[id]);
      await pool.query(`INSERT INTO ${schema}.ledger(buyer_id,kind,available_delta,held_delta,external_ref) VALUES($1,'fund',200,0,$2)`,[id,`synthetic:${id}`]);
      for(const [kind,key] of [["source","s"],["snapshot","before"],["snapshot","after"],["document","doc"]]) await pool.query(`INSERT INTO ${schema}.resources(buyer_id,kind,id,ready) VALUES($1,$2,$3,true)`,[id,kind,key]);
    }
    for(const service of ["pricing_snapshot","pricing_compare","document_extract"]) await pool.query(`INSERT INTO ${schema}.prices(service,version,currency,amount_minor,enabled) VALUES($1,'synthetic-v1','USD',100,true)`,[service]);
  });
  const input={sourceId:"s"};
  async function quote(){return backend.quote(p,"pricing_snapshot",input);}
  function request(quoteId:string,key="abcdefghijklmnop"){
    const v={service:"pricing_snapshot" as const,input,quoteId};return {...v,idempotencyKey:key,digest:digest(v)};
  }
  async function counts(){const r=await pool.query(`SELECT (SELECT count(*)::int FROM ${schema}.jobs) AS jobs,(SELECT count(*)::int FROM ${schema}.reservations) AS reservations,(SELECT count(*)::int FROM ${schema}.outbox) AS outbox,(SELECT count(*)::int FROM ${schema}.ledger WHERE kind='reserve') AS ledger`);return r.rows[0];}
  it("maps verified subject to local buyer, not token sub-as-UUID",async()=>{expect(await backend.resolve(issuer,{...p,buyerId:"alice",scopes:[...scopes,"admin"]})).toEqual(p);});
  it("supports owned inputs for all three services",async()=>{
    const cases: [Service,Record<string,unknown>][]=[["pricing_snapshot",input],["pricing_compare",{beforeId:"before",afterId:"after"}],["document_extract",{documentId:"doc",profile:"scalar-fields-v1",fields:["name"]}]];
    for(const [service,value] of cases)expect((await backend.quote(p,service,value)).amountMinor).toBe(100);
  });
  it("atomically writes reservation, ledger, job and outbox",async()=>{
    const q=await quote();expect((await backend.submit(p,request(q.id))).status).toBe("queued");
    expect(await counts()).toEqual({jobs:1,reservations:1,outbox:1,ledger:1});
    expect((await pool.query(`SELECT available_minor,held_minor FROM ${schema}.wallets WHERE buyer_id=$1`,[a])).rows[0]).toEqual({available_minor:"100",held_minor:"100"});
  });
  it("concurrent same-key replays create one job and debit once",async()=>{
    const q=await quote(),v=request(q.id);const r=await Promise.all(Array.from({length:4},()=>backend.submit(p,v)));
    expect(new Set(r.map(x=>x.id)).size).toBe(1);expect(await counts()).toEqual({jobs:1,reservations:1,outbox:1,ledger:1});
  });
  it("same key with changed quote conflicts",async()=>{const q=await quote(),other=await quote();await backend.submit(p,request(q.id));await expect(backend.submit(p,request(other.id))).rejects.toMatchObject({status:409,code:"idempotency_conflict"});});
  it("different keys cannot spend one quote twice",async()=>{const q=await quote();await backend.submit(p,request(q.id));await expect(backend.submit(p,request(q.id,"ponmlkjihgfedcba"))).rejects.toMatchObject({status:409,code:"quote_already_used"});});
  it("concurrent independent jobs cannot overdraw capacity",async()=>{
    await pool.query(`UPDATE ${schema}.wallets SET available_minor=150 WHERE buyer_id=$1`,[a]);
    const q1=await quote(),q2=await quote();const r=await Promise.allSettled([backend.submit(p,request(q1.id)),backend.submit(p,request(q2.id,"ponmlkjihgfedcba"))]);
    expect(r.filter(x=>x.status==="fulfilled")).toHaveLength(1);expect(await counts()).toEqual({jobs:1,reservations:1,outbox:1,ledger:1});
  });
  it("enforces delegation spending limit before wallet mutation",async()=>{await pool.query(`UPDATE ${schema}.delegations SET limit_minor=50 WHERE buyer_id=$1`,[a]);const q=await quote();await expect(backend.submit(p,request(q.id))).rejects.toMatchObject({code:"spending_limit"});expect((await counts()).jobs).toBe(0);});
  it("enforces admitted-job concurrency",async()=>{await pool.query(`UPDATE ${schema}.delegations SET max_open_jobs=1 WHERE buyer_id=$1`,[a]);const q1=await quote(),q2=await quote();await backend.submit(p,request(q1.id));await expect(backend.submit(p,request(q2.id,"ponmlkjihgfedcba"))).rejects.toMatchObject({status:429});});
  it("rechecks revocation at admission",async()=>{const q=await quote();await pool.query(`UPDATE ${schema}.delegations SET active=false WHERE buyer_id=$1`,[a]);await expect(backend.submit(p,request(q.id))).rejects.toMatchObject({status:403});});
  it("rejects expired quotes but preserves an admitted replay",async()=>{const q=await quote();await backend.submit(p,request(q.id));await pool.query(`UPDATE ${schema}.quotes SET expires_at=clock_timestamp()-interval '1 minute'`);expect((await backend.submit(p,request(q.id))).status).toBe("queued");const q2=await quote();await pool.query(`UPDATE ${schema}.quotes SET expires_at=clock_timestamp()-interval '1 minute' WHERE id=$1`,[q2.id]);await expect(backend.submit(p,request(q2.id,"ponmlkjihgfedcba"))).rejects.toMatchObject({code:"quote_expired"});});
  it("isolates buyers, clients and owned resources",async()=>{
    const q=await quote(),j=await backend.submit(p,request(q.id));expect(await backend.job({...p,buyerId:b},j.id)).toBeNull();
    await expect(backend.submit({...p,buyerId:b},request(q.id))).rejects.toMatchObject({status:404});
    await pool.query(`DELETE FROM ${schema}.resources WHERE buyer_id=$1 AND kind='source'`,[a]);await expect(quote()).rejects.toMatchObject({status:404});
    await expect(backend.job({...p,clientId:"other"},j.id)).rejects.toMatchObject({status:403});
  });
  it("rolls back ALL admission writes if outbox insertion fails",async()=>{
    const q=await quote();await pool.query(`CREATE FUNCTION ${schema}.reject_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END $$; CREATE TRIGGER reject_outbox BEFORE INSERT ON ${schema}.outbox FOR EACH ROW EXECUTE FUNCTION ${schema}.reject_outbox()`);
    try {await expect(backend.submit(p,request(q.id))).rejects.toMatchObject({code:"commerce_unavailable"});expect(await counts()).toEqual({jobs:0,reservations:0,outbox:0,ledger:0});expect((await pool.query(`SELECT available_minor,held_minor FROM ${schema}.wallets WHERE buyer_id=$1`,[a])).rows[0]).toEqual({available_minor:"200",held_minor:"0"});expect((await pool.query(`SELECT reserved_minor FROM ${schema}.delegations WHERE buyer_id=$1`,[a])).rows[0].reserved_minor).toBe("0");}
    finally {await pool.query(`DROP TRIGGER reject_outbox ON ${schema}.outbox; DROP FUNCTION ${schema}.reject_outbox()`);}
  });
});
