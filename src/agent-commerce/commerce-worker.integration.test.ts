import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { digest, type Principal, type Service } from "./api.js";
import { PostgresCommerce } from "./postgres-commerce.js";
import { composeCommerceWorker } from "./commerce-worker.js";
import type { SafeFetchDeps } from "../agent-services/safe-fetch.js";

const url = process.env.TEST_DATABASE_URL;
if (process.env.REQUIRE_DB_TESTS === "true" && !url) throw new Error("TEST_DATABASE_URL_required");
if (url && process.env.CODEX_DB_TEST_ACK !== "disposable-database-only") throw new Error("disposable_database_ack_required");

describe.runIf(Boolean(url))("composed commerce worker executes a real pricing_snapshot job", () => {
  const schema = `commerce_worker_test_${randomUUID().replaceAll("-", "")}`;
  const buyer = randomUUID();
  const issuer = "https://synthetic-issuer.example.test";
  const scopes = ["commerce:quote", "services:execute", "jobs:read", "results:read"];
  const p: Principal = { buyerId: buyer, clientId: "agent", scopes };
  const fixtureBody = JSON.stringify({ offers: [{ name: "Basic", amount: 10, currency: "USD", interval: "month" }] });
  let pool: Pool, backend: PostgresCommerce, created = false;

  // Only the network layer is stubbed: DNS resolves to a public fixture IP and
  // the connection returns one 200 JSON response. Everything else — admission,
  // quoting, lease fencing, provider execution, settlement, receipts and
  // snapshot persistence — runs the real production code against PostgreSQL.
  const fetchDeps: SafeFetchDeps = {
    resolve: async () => [{ address: "93.184.216.34", family: 4 }],
    connect: async () => ({
      status: 200,
      headers: { "content-type": "application/json" },
      stream: (async function* () { yield Buffer.from(fixtureBody); })(),
    }),
  };

  beforeAll(async () => {
    // The snapshot stores address as_sources/as_snapshots unqualified, so the
    // worker pool pins the schema via search_path; commerce tables are
    // schema-qualified explicitly, exactly as in production composition.
    pool = new Pool({ connectionString: url, max: 8, connectionTimeoutMillis: 5000, statement_timeout: 10000, options: `-c search_path=${schema}` });
    const c = await pool.connect();
    try {
      await c.query(readFileSync(new URL("../../migrations/standalone_commerce_v1.sql", import.meta.url), "utf8").replaceAll("agent_commerce", schema));
      await c.query(readFileSync(new URL("../../migrations/standalone_commerce_worker_v1.sql", import.meta.url), "utf8").replaceAll("agent_commerce", schema));
      await c.query("BEGIN");
      await c.query(`SET LOCAL search_path TO "${schema}"`);
      await c.query(readFileSync(new URL("../../migrations/001_agent_service_snapshots.sql", import.meta.url), "utf8"));
      await c.query(readFileSync(new URL("../../migrations/002_agent_service_sources.sql", import.meta.url), "utf8"));
      await c.query("COMMIT");
      created = true;
    } catch (e) {
      await c.query("ROLLBACK").catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
    backend = new PostgresCommerce(pool, schema);
  }, 30000);

  afterAll(async () => {
    if (pool) {
      try { if (created) await pool.query(`DROP SCHEMA "${schema}" CASCADE`); }
      finally { await pool.end(); }
    }
  }, 30000);

  beforeEach(async () => {
    await pool.query(`TRUNCATE ${schema}.buyers, ${schema}.prices, ${schema}.as_buyers CASCADE`);
    await pool.query(`INSERT INTO ${schema}.buyers VALUES($1,$2,'buyer',true,'USD')`, [buyer, issuer]);
    await pool.query(`INSERT INTO ${schema}.delegations(buyer_id,client_id,active,expires_at,scopes,services,limit_minor,max_open_jobs) VALUES($1,'agent',true,clock_timestamp()+interval '1 hour',$2,$3,1000,10)`, [buyer, scopes, ["pricing_snapshot", "pricing_compare", "document_extract"]]);
    await pool.query(`INSERT INTO ${schema}.wallets(buyer_id,available_minor) VALUES($1,500)`, [buyer]);
    await pool.query(`INSERT INTO ${schema}.ledger(buyer_id,kind,available_delta,held_delta,external_ref) VALUES($1,'fund',500,0,'synthetic-funding')`, [buyer]);
    await pool.query(`INSERT INTO ${schema}.resources(buyer_id,kind,id,ready) VALUES($1,'source','src-1',true)`, [buyer]);
    await pool.query(`INSERT INTO ${schema}.prices VALUES('pricing_snapshot','synthetic','USD',100,true)`);
    await pool.query(`INSERT INTO ${schema}.as_buyers(id,issuer,subject) VALUES($1,$2,'buyer')`, [buyer, issuer]);
    await pool.query(`INSERT INTO ${schema}.as_sources(buyer_id,source_id,url,approved_for_capture) VALUES($1,'src-1','https://pricing.example.test/offers',true)`, [buyer]);
  });

  async function enqueue(service: Service, input: Record<string, unknown>) {
    const q = await backend.quote(p, service, input);
    const v = { service, input, quoteId: q.id };
    return backend.submit(p, { ...v, idempotencyKey: randomUUID(), digest: digest(v) });
  }

  it("executes a pricing_snapshot job end to end through the composed production providers", async () => {
    const worker = composeCommerceWorker({ pool, schema, fetchDeps });
    const job = await enqueue("pricing_snapshot", { sourceId: "src-1" });
    expect(await worker.runOnce()).toBe("succeeded");

    const result = await backend.result(p, job.id);
    expect(result?.value).toMatchObject({
      id: `snap-${job.id}`, sourceUrl: "https://pricing.example.test/offers",
      plans: [{ name: "Basic", amount: 10, currency: "USD" }],
    });

    const accounting = (await pool.query(
      `SELECT w.available_minor, w.held_minor, d.spent_minor,
              (SELECT count(*)::int FROM ${schema}.receipts) AS receipts,
              (SELECT count(*)::int FROM ${schema}.results) AS results
         FROM ${schema}.wallets w JOIN ${schema}.delegations d USING(buyer_id)
        WHERE w.buyer_id = $1`, [buyer])).rows[0];
    expect(accounting).toEqual({ available_minor: "400", held_minor: "0", spent_minor: "100", receipts: 1, results: 1 });

    const stored = (await pool.query(`SELECT payload->>'id' AS id FROM ${schema}.as_snapshots WHERE buyer_id = $1`, [buyer])).rows;
    expect(stored).toEqual([{ id: `snap-${job.id}` }]);
    const provenance = (await pool.query(`SELECT source_id, extracted_plans, content_sha256 FROM ${schema}.as_snapshot_provenance WHERE buyer_id = $1`, [buyer])).rows[0];
    expect(provenance).toMatchObject({ source_id: "src-1", extracted_plans: 1 });
    expect(provenance.content_sha256).toMatch(/^[a-f0-9]{64}$/);

    expect(await worker.runOnce()).toBe("idle");
  });

  it("rejects capture of a source that is not approved for capture, without charging", async () => {
    await pool.query(`UPDATE ${schema}.as_sources SET approved_for_capture = false WHERE buyer_id = $1`, [buyer]);
    const worker = composeCommerceWorker({ pool, schema, fetchDeps });
    const job = await enqueue("pricing_snapshot", { sourceId: "src-1" });
    expect(await worker.runOnce()).toBe("failed");
    const receipt = (await pool.query(`SELECT error_code, charged_minor FROM ${schema}.receipts`)).rows[0];
    expect(receipt).toEqual({ error_code: "provider_rejected", charged_minor: 0 });
    const snapshots = (await pool.query(`SELECT count(*)::int AS n FROM ${schema}.as_snapshots`)).rows[0].n;
    expect(snapshots).toBe(0);
    expect(await backend.result(p, job.id)).toBeNull();
  });
});
