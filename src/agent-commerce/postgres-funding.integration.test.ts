import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, afterAll as teardown, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PostgresFunding } from "./postgres-funding.js";

const url = process.env.TEST_DATABASE_URL;
if (process.env.REQUIRE_DB_TESTS === "true" && !url) throw new Error("TEST_DATABASE_URL_required");
if (url && process.env.CODEX_DB_TEST_ACK !== "disposable-database-only") throw new Error("disposable_database_ack_required");

describe.runIf(Boolean(url))("funding order settlement", () => {
  const schema = `funding_test_${randomUUID().replaceAll("-", "")}`;
  const buyer = randomUUID();
  const issuer = "https://synthetic-issuer.example.test";
  let pool: Pool, funding: PostgresFunding, created = false;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 8, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
    const c = await pool.connect();
    try {
      await c.query(readFileSync(new URL("../../migrations/standalone_commerce_v1.sql", import.meta.url), "utf8").replaceAll("agent_commerce", schema));
      await c.query(readFileSync(new URL("../../migrations/standalone_commerce_funding_v1.sql", import.meta.url), "utf8").replaceAll("agent_commerce", schema));
      created = true;
    } catch (e) { await c.query("ROLLBACK").catch(() => undefined); throw e; }
    finally { c.release(); }
    funding = new PostgresFunding(pool, schema);
  }, 30000);
  afterAll(async () => {
    if (pool) { try { if (created) await pool.query(`DROP SCHEMA "${schema}" CASCADE`); } finally { await pool.end(); } }
  }, 30000);

  beforeEach(async () => {
    await pool.query(`TRUNCATE ${schema}.buyers, ${schema}.funding_events CASCADE`);
    await pool.query(`INSERT INTO ${schema}.buyers VALUES($1,$2,'buyer',true,'USD')`, [buyer, issuer]);
  });

  async function wallet() {
    return (await pool.query(`SELECT available_minor, held_minor FROM ${schema}.wallets WHERE buyer_id=$1`, [buyer])).rows[0] ?? null;
  }
  async function orderRow(ref: string) {
    return (await pool.query(`SELECT status FROM ${schema}.funding_orders WHERE provider='stripe' AND provider_ref=$1`, [ref])).rows[0] ?? null;
  }
  async function open(ref: string, amountMinor = 500, provider: "stripe" | "crypto" = "stripe") {
    return funding.openOrder({ buyerId: buyer, provider, providerRef: ref, mode: "test", amountMinor, currency: "USD", ttlSeconds: 3600 });
  }
  async function credit(ref: string, eventId: string, amountMinor = 500, currency = "USD") {
    return funding.credit({ provider: "stripe", providerEventId: eventId, providerRef: ref, amountMinor, currency, evidence: { synthetic: true } });
  }

  it("opens an order and credits the wallet atomically", async () => {
    const order = await open("pi_first");
    expect(order.status).toBe("pending");
    expect(await credit("pi_first", "evt_1")).toEqual({ credited: true, orderId: order.id, availableMinor: "500" });
    expect(await wallet()).toEqual({ available_minor: "500", held_minor: "0" });
    const ledger = (await pool.query(`SELECT kind, available_delta, held_delta, external_ref FROM ${schema}.ledger`)).rows;
    expect(ledger).toEqual([{ kind: "fund", available_delta: "500", held_delta: "0", external_ref: "stripe:pi_first" }]);
    expect((await orderRow("pi_first")).status).toBe("credited");
    expect((await pool.query(`SELECT status FROM ${schema}.funding_events`)).rows).toEqual([{ status: "settled" }]);
  });

  it("duplicate delivery of one provider event is idempotent", async () => {
    await open("pi_dup");
    expect(await credit("pi_dup", "evt_a")).toMatchObject({ credited: true });
    expect(await credit("pi_dup", "evt_a")).toEqual({ credited: false, code: "duplicate_event" });
    expect(await wallet()).toEqual({ available_minor: "500", held_minor: "0" });
    expect((await pool.query(`SELECT count(*)::int AS n FROM ${schema}.funding_events`)).rows[0].n).toBe(1);
  });

  it("distinct events for one payment credit exactly once", async () => {
    await open("pi_replay");
    expect(await credit("pi_replay", "evt_a")).toMatchObject({ credited: true });
    expect(await credit("pi_replay", "evt_b")).toEqual({ credited: false, code: "already_credited" });
    expect(await wallet()).toEqual({ available_minor: "500", held_minor: "0" });
    const events = (await pool.query(`SELECT status, error_code FROM ${schema}.funding_events ORDER BY provider_event_id`)).rows;
    expect(events).toEqual([{ status: "settled", error_code: null }, { status: "rejected", error_code: "already_credited" }]);
  });

  it("amount mismatch rejects without consuming the order", async () => {
    await open("pi_amount");
    expect(await credit("pi_amount", "evt_a", 400)).toEqual({ credited: false, code: "amount_mismatch" });
    expect(await wallet()).toBeNull();
    expect((await orderRow("pi_amount")).status).toBe("pending");
    expect(await credit("pi_amount", "evt_b")).toMatchObject({ credited: true });
    expect(await wallet()).toEqual({ available_minor: "500", held_minor: "0" });
  });

  it("currency mismatch rejects without consuming the order", async () => {
    await open("pi_cur");
    expect(await credit("pi_cur", "evt_a", 500, "EUR")).toEqual({ credited: false, code: "currency_mismatch" });
    expect(await wallet()).toBeNull();
    expect((await orderRow("pi_cur")).status).toBe("pending");
  });

  it("unknown payment reference is durably recorded and never credited", async () => {
    expect(await credit("pi_ghost", "evt_a")).toEqual({ credited: false, code: "unknown_order" });
    expect(await wallet()).toBeNull();
    const events = (await pool.query(`SELECT status, error_code FROM ${schema}.funding_events`)).rows;
    expect(events).toEqual([{ status: "rejected", error_code: "unknown_order" }]);
  });

  it("expired order cannot be credited", async () => {
    await open("pi_late");
    await pool.query(`UPDATE ${schema}.funding_orders SET expires_at=clock_timestamp()-interval '1 second' WHERE provider_ref='pi_late'`);
    expect(await credit("pi_late", "evt_a")).toEqual({ credited: false, code: "order_expired" });
    expect(await wallet()).toBeNull();
  });

  it("inactive buyer cannot be credited", async () => {
    await open("pi_off");
    await pool.query(`UPDATE ${schema}.buyers SET active=false WHERE id=$1`, [buyer]);
    expect(await credit("pi_off", "evt_a")).toEqual({ credited: false, code: "buyer_inactive" });
  });

  it("concurrent settlement attempts credit exactly once", async () => {
    await open("pi_race");
    const results = await Promise.all([credit("pi_race", "evt_a"), credit("pi_race", "evt_b")]);
    expect(results.filter(r => r.credited)).toHaveLength(1);
    expect(results.filter(r => !r.credited)).toEqual([{ credited: false, code: "already_credited" }]);
    expect(await wallet()).toEqual({ available_minor: "500", held_minor: "0" });
    expect((await pool.query(`SELECT count(*)::int AS n FROM ${schema}.ledger WHERE kind='fund'`)).rows[0].n).toBe(1);
  });

  it("credits a buyer that has no wallet row yet", async () => {
    await open("pi_new");
    expect(await credit("pi_new", "evt_a")).toMatchObject({ credited: true, availableMinor: "500" });
    expect(await wallet()).toEqual({ available_minor: "500", held_minor: "0" });
  });

  it("openOrder is idempotent and rejects conflicting reuse", async () => {
    const first = await open("pi_idem");
    const second = await open("pi_idem");
    expect(second.id).toBe(first.id);
    expect((await pool.query(`SELECT count(*)::int AS n FROM ${schema}.funding_orders`)).rows[0].n).toBe(1);
    await expect(open("pi_idem", 600)).rejects.toMatchObject({ code: "funding_ref_conflict" });
    await expect(funding.openOrder({ buyerId: randomUUID(), provider: "stripe", providerRef: "pi_foreign", mode: "test", amountMinor: 500, currency: "USD" })).rejects.toMatchObject({ code: "buyer_inactive" });
  });
});
