import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ApiError, type Dependencies, type Principal } from "./api.js";
import { PostgresCommerce } from "./postgres-commerce.js";
import { PostgresFundingOrders } from "./postgres-funding-orders.js";
import { createHttpApp } from "../http-app.js";
import { loadTools, findProjectFile } from "../load-tools.js";
import { loadCatalog } from "../catalog.js";

const url = process.env.TEST_DATABASE_URL;
if (process.env.REQUIRE_DB_TESTS === "true" && !url) throw new Error("TEST_DATABASE_URL_required");
if (url && process.env.CODEX_DB_TEST_ACK !== "disposable-database-only") throw new Error("disposable_database_ack_required");

describe.runIf(Boolean(url))("agent funding order creation", () => {
  const schema = `funding_api_test_${randomUUID().replaceAll("-", "")}`;
  const buyer = randomUUID();
  const issuer = "https://synthetic-issuer.example.test";
  const scopes = ["commerce:quote", "funding:create"];
  const principal: Principal = { buyerId: buyer, clientId: "agent", scopes };
  let pool: Pool, backend: PostgresCommerce, orders: PostgresFundingOrders, created = false;
  let server: Server | undefined, base: string | undefined;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 8, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
    const c = await pool.connect();
    try {
      for (const file of ["standalone_commerce_v1.sql", "standalone_commerce_funding_v1.sql", "standalone_commerce_funding_api_v1.sql"]) {
        await c.query(readFileSync(new URL(`../../migrations/${file}`, import.meta.url), "utf8").replaceAll("agent_commerce", schema));
      }
      created = true;
    } catch (e) { await c.query("ROLLBACK").catch(() => undefined); throw e; }
    finally { c.release(); }
    backend = new PostgresCommerce(pool, schema);
    orders = new PostgresFundingOrders(pool, schema);
  }, 30000);

  afterAll(async () => {
    if (pool) { try { if (created) await pool.query(`DROP SCHEMA "${schema}" CASCADE`); } finally { await pool.end(); } }
  }, 30000);

  beforeEach(async () => {
    await pool.query(`TRUNCATE ${schema}.buyers, ${schema}.funding_packages, ${schema}.funding_events CASCADE`);
    await pool.query(`INSERT INTO ${schema}.buyers VALUES($1,$2,'buyer',true,'USD')`, [buyer, issuer]);
    await pool.query(`INSERT INTO ${schema}.delegations(buyer_id,client_id,active,expires_at,scopes,services,limit_minor,max_open_jobs) VALUES($1,'agent',true,clock_timestamp()+interval '1 hour',$2,$3,1000,10)`, [buyer, scopes, ["pricing_snapshot"]]);
    await pool.query(`INSERT INTO ${schema}.funding_packages(id,network,mode,token_contract,asset_symbol,decimals,recipient_address,amount_minor,currency,amount_atomic,ttl_seconds,max_open_intents,active) VALUES
      ('pkg-basic','base-sepolia','test','0x036CbD53842c5426634e7929541eC2318f3dCF7e','USDC',6,'0x1111111111111111111111111111111111111111',500,'USD','500000000',3600,3,true),
      ('pkg-eur','base-sepolia','test','0x036CbD53842c5426634e7929541eC2318f3dCF7e','USDC',6,'0x1111111111111111111111111111111111111111',500,'EUR','500000000',3600,3,true),
      ('pkg-off','base-sepolia','test','0x036CbD53842c5426634e7929541eC2318f3dCF7e','USDC',6,'0x1111111111111111111111111111111111111111',500,'USD','500000000',3600,3,false)`);
    const commerce: Dependencies = {
      enabled: true, backend,
      authenticate: async token => {
        if (token === "agent-token") return { buyerId: buyer, clientId: "agent", scopes };
        if (token === "noscope-token") return { buyerId: buyer, clientId: "agent", scopes: ["commerce:quote"] };
        throw new ApiError(401, "unauthorized");
      },
      consume: async () => ({ allowed: true, retryAfter: 0 }),
    };
    const app = createHttpApp({
      tools: loadTools(), catalog: loadCatalog(),
      agentCardJson: findProjectFile("well-known/agent-card.json"),
      commerce,
      funding: { enabled: true, authenticate: commerce.authenticate, consume: commerce.consume, backend: orders },
      dispatch: async () => { throw new Error("unexpected_fallback"); },
      storefrontRouter: (_req, _res, next) => next(), pricingRoute: "/disabled-test-pricing",
    });
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => { const s = server!; s.once("listening", resolve); s.once("error", reject); });
    base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  }, 30000);

  afterEach(async () => {
    const s = server; server = undefined;
    if (s) await new Promise<void>((resolve, reject) => { s.closeAllConnections(); s.close(e => e ? reject(e) : resolve()); });
  }, 30000);

  async function createOrder(packageId: string, key: string, token = "agent-token") {
    return fetch(`${base}/api/v1/agent/funding/orders`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "Idempotency-Key": key, "content-type": "application/json" },
      body: JSON.stringify({ packageId }),
    });
  }
  async function counts() {
    const r = await pool.query(`SELECT
      (SELECT count(*)::int FROM ${schema}.funding_orders) AS orders,
      (SELECT count(*)::int FROM ${schema}.funding_intent_keys) AS keys,
      (SELECT count(*)::int FROM ${schema}.wallets) AS wallets,
      (SELECT count(*)::int FROM ${schema}.ledger) AS ledger`);
    return r.rows[0];
  }

  it("creates a deposit intent without any financial writes", async () => {
    const response = await createOrder("pkg-basic", "integration-key-0001");
    expect(response.status).toBe(201);
    const body = await response.json() as { data: Record<string, unknown> };
    expect(body.data).toMatchObject({
      status: "awaiting_payment", network: "base-sepolia",
      asset: { symbol: "USDC", contract: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", decimals: 6 },
      recipient: "0x1111111111111111111111111111111111111111",
      amountAtomic: "500000000",
      credit: { amountMinor: "500", currency: "USD" },
    });
    expect(String(body.data.reference)).toMatch(/^dep_[0-9a-f-]{36}$/);
    expect(String(body.data.orderId)).toMatch(/^[0-9a-f-]{36}$/);
    expect(await counts()).toEqual({ orders: 1, keys: 1, wallets: 0, ledger: 0 });
    const row = (await pool.query(`SELECT provider, mode, status, buyer_id::text AS buyer_id FROM ${schema}.funding_orders`)).rows[0];
    expect(row).toEqual({ provider: "crypto", mode: "test", status: "pending", buyer_id: buyer });
  });

  it("replays the same idempotency key with identical instructions", async () => {
    const first = await createOrder("pkg-basic", "integration-key-0002");
    const second = await createOrder("pkg-basic", "integration-key-0002");
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    const a = await first.json() as { data: unknown };
    const b = await second.json() as { data: unknown };
    expect(b.data).toEqual(a.data);
    expect((await counts()).orders).toBe(1);
  });

  it("mints a unique deposit amount for each concurrent intent", async () => {
    const first = await createOrder("pkg-basic", "integration-key-uniq-1");
    const second = await createOrder("pkg-basic", "integration-key-uniq-2");
    const a = ((await first.json()) as { data: { amountAtomic: string } }).data.amountAtomic;
    const b = ((await second.json()) as { data: { amountAtomic: string } }).data.amountAtomic;
    expect(a).not.toBe(b);
    expect([a, b].sort()).toEqual(["500000000", "500000001"]);
    expect((await counts()).orders).toBe(2);
  });

  it("conflicts when the same key reuses a different package", async () => {
    await createOrder("pkg-basic", "integration-key-0003");
    const response = await createOrder("pkg-eur", "integration-key-0003");
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("idempotency_conflict");
    expect((await counts()).orders).toBe(1);
  });

  it("rejects unknown, inactive and currency-mismatched packages", async () => {
    for (const [packageId, status, code] of [["missing", 404, "unknown_package"], ["pkg-off", 404, "unknown_package"], ["pkg-eur", 409, "currency_mismatch"]] as const) {
      const response = await createOrder(packageId, `integration-key-${packageId}`);
      expect(response.status).toBe(status);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe(code);
    }
    expect(await counts()).toEqual({ orders: 0, keys: 0, wallets: 0, ledger: 0 });
  });

  it("enforces authentication and the delegation funding scope", async () => {
    const noAuth = await fetch(`${base}/api/v1/agent/funding/orders`, {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "integration-key-noauth" },
      body: JSON.stringify({ packageId: "pkg-basic" }),
    });
    expect(noAuth.status).toBe(401);
    const noScope = await createOrder("pkg-basic", "integration-key-noscope", "noscope-token");
    expect(noScope.status).toBe(403);
    expect(((await noScope.json()) as { error: { code: string } }).error.code).toBe("insufficient_scope");
    expect((await counts()).orders).toBe(0);
  });

  it("enforces the open-intent limit per buyer", async () => {
    for (let i = 0; i < 3; i++) await createOrder("pkg-basic", `integration-key-cap-${i}`);
    const response = await createOrder("pkg-basic", "integration-key-cap-3");
    expect(response.status).toBe(429);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("funding_limit");
    expect((await counts()).orders).toBe(3);
  });

  it("leaves the commerce router mounted and reachable", async () => {
    const response = await fetch(`${base}/api/v1/agent/jobs/xyz`, { headers: { authorization: "Bearer agent-token" } });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("insufficient_scope");
  });
});
