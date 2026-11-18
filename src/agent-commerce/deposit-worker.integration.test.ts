import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Principal } from "./api.js";
import { PostgresFunding } from "./postgres-funding.js";
import { PostgresFundingOrders } from "./postgres-funding-orders.js";
import { CryptoDepositWorker } from "./deposit-worker.js";
import { TRANSFER_TOPIC, type EvmLog, type RpcClient } from "./deposit-rpc.js";

const url = process.env.TEST_DATABASE_URL;
if (process.env.REQUIRE_DB_TESTS === "true" && !url) throw new Error("TEST_DATABASE_URL_required");
if (url && process.env.CODEX_DB_TEST_ACK !== "disposable-database-only") throw new Error("disposable_database_ack_required");

describe.runIf(Boolean(url))("crypto deposit worker", () => {
  const schema = `deposit_test_${randomUUID().replaceAll("-", "")}`;
  const buyer = randomUUID();
  const issuer = "https://synthetic-issuer.example.test";
  const token = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
  const recipient = "0x2222222222222222222222222222222222222222";
  const sender = "0x3333333333333333333333333333333333333333";
  const scopes = ["funding:create"];
  const principal: Principal = { buyerId: buyer, clientId: "agent", scopes };
  let pool: Pool, funding: PostgresFunding, orders: PostgresFundingOrders, created = false;

  function padTopic(address: string): string {
    return "0x000000000000000000000000" + address.slice(2).toLowerCase();
  }
  function logFor(valueAtomic: bigint, to = recipient, blockNumber = 80, txHash = "0x" + "ab".repeat(32), logIndex = 0): EvmLog {
    return {
      transactionHash: txHash,
      logIndex: "0x" + logIndex.toString(16),
      blockNumber: "0x" + blockNumber.toString(16),
      address: token,
      topics: [TRANSFER_TOPIC, padTopic(sender), padTopic(to)],
      data: "0x" + valueAtomic.toString(16).padStart(64, "0"),
    };
  }
  function fakeRpc(logs: EvmLog[], head = 100n): RpcClient {
    return { blockNumber: async () => head, getLogs: async () => logs };
  }
  async function wallet() {
    return (await pool.query(`SELECT available_minor, held_minor FROM ${schema}.wallets WHERE buyer_id=$1`, [buyer])).rows[0] ?? null;
  }
  async function openIntent(key: string) {
    return orders.create(principal, { packageId: "pkg", idempotencyKey: key });
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 8, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
    const c = await pool.connect();
    try {
      for (const file of ["standalone_commerce_v1.sql", "standalone_commerce_funding_v1.sql", "standalone_commerce_funding_api_v1.sql", "standalone_commerce_deposit_v1.sql"]) {
        await c.query(readFileSync(new URL(`../../migrations/${file}`, import.meta.url), "utf8").replaceAll("agent_commerce", schema));
      }
      created = true;
    } catch (e) { await c.query("ROLLBACK").catch(() => undefined); throw e; }
    finally { c.release(); }
    funding = new PostgresFunding(pool, schema);
    orders = new PostgresFundingOrders(pool, schema);
  }, 30000);
  afterAll(async () => {
    if (pool) { try { if (created) await pool.query(`DROP SCHEMA "${schema}" CASCADE`); } finally { await pool.end(); } }
  }, 30000);

  beforeEach(async () => {
    await pool.query(`TRUNCATE ${schema}.buyers, ${schema}.funding_packages, ${schema}.funding_events, ${schema}.funding_scan_cursors CASCADE`);
    await pool.query(`INSERT INTO ${schema}.buyers VALUES($1,$2,'buyer',true,'USD')`, [buyer, issuer]);
    await pool.query(`INSERT INTO ${schema}.delegations(buyer_id,client_id,active,expires_at,scopes,services,limit_minor,max_open_jobs) VALUES($1,'agent',true,clock_timestamp()+interval '1 hour',$2,$3,1000,10)`, [buyer, scopes, ["pricing_snapshot"]]);
    await pool.query(`INSERT INTO ${schema}.funding_packages(id,network,mode,token_contract,asset_symbol,decimals,recipient_address,amount_minor,currency,amount_atomic,ttl_seconds,max_open_intents,active) VALUES('pkg','base-sepolia','test','${token}','USDC',6,'${recipient}',500,'USD','500000000',3600,3,true)`);
  });

  it("credits a verified confirmed transfer to the matching intent exactly once", async () => {
    const intent = await openIntent("deposit-integration-key-01");
    const atomic = BigInt(intent.instructions.amountAtomic);
    const worker = new CryptoDepositWorker(pool, funding, fakeRpc([logFor(atomic)]), schema, 12, 1000);
    expect(await worker.runOnce()).toBe("processed");
    expect(await wallet()).toEqual({ available_minor: "500", held_minor: "0" });
    expect((await pool.query(`SELECT status, error_code FROM ${schema}.funding_events`)).rows)
      .toEqual([{ status: "settled", error_code: null }]);
    expect((await pool.query(`SELECT kind, external_ref FROM ${schema}.ledger`)).rows)
      .toEqual([{ kind: "fund", external_ref: `crypto:${intent.instructions.reference}` }]);
    expect((await pool.query(`SELECT last_block FROM ${schema}.funding_scan_cursors`)).rows)
      .toEqual([{ last_block: "88" }]);
    expect(await worker.runOnce()).toBe("idle");
    expect(await wallet()).toEqual({ available_minor: "500", held_minor: "0" });
    expect((await pool.query(`SELECT count(*)::int AS n FROM ${schema}.funding_events`)).rows[0].n).toBe(1);
  });

  it("ignores transfers that match no live intent without financial writes", async () => {
    await openIntent("deposit-integration-key-02");
    const worker = new CryptoDepositWorker(pool, funding, fakeRpc([logFor(500000005n)]), schema, 12, 1000);
    expect(await worker.runOnce()).toBe("idle");
    expect(await wallet()).toBeNull();
    expect((await pool.query(`SELECT count(*)::int AS n FROM ${schema}.funding_events`)).rows[0].n).toBe(0);
    expect((await pool.query(`SELECT count(*)::int AS n FROM ${schema}.ledger`)).rows[0].n).toBe(0);
    expect((await pool.query(`SELECT last_block FROM ${schema}.funding_scan_cursors`)).rows).toEqual([{ last_block: "88" }]);
  });

  it("ignores transfers to a different recipient", async () => {
    const intent = await openIntent("deposit-integration-key-03");
    const worker = new CryptoDepositWorker(pool, funding, fakeRpc([logFor(BigInt(intent.instructions.amountAtomic), "0x4444444444444444444444444444444444444444")]), schema, 12, 1000);
    expect(await worker.runOnce()).toBe("idle");
    expect(await wallet()).toBeNull();
  });

  it("does not credit transfers outside the confirmed window", async () => {
    const intent = await openIntent("deposit-integration-key-04");
    const worker = new CryptoDepositWorker(pool, funding, fakeRpc([logFor(BigInt(intent.instructions.amountAtomic), recipient, 95)]), schema, 12, 1000);
    expect(await worker.runOnce()).toBe("idle");
    expect(await wallet()).toBeNull();
    expect((await pool.query(`SELECT count(*)::int AS n FROM ${schema}.funding_events`)).rows[0].n).toBe(0);
  });
});
