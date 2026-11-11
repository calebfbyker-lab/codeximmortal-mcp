import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compareSnapshots } from "../agent-services/pricing-compare.js";
import { PostgresSnapshotRepository } from "./postgres-snapshot-repository.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (process.env.REQUIRE_DB_TESTS === "true" && !databaseUrl) {
  throw new Error("TEST_DATABASE_URL_required");
}
if (databaseUrl && process.env.CODEX_DB_TEST_ACK !== "disposable-database-only") {
  throw new Error("disposable_database_ack_required");
}

// No URL: explicitly SKIPPED, never a database PASS.
describe.runIf(Boolean(databaseUrl))("PostgreSQL two-buyer isolation (synthetic fixtures)", () => {
  const schema = `ci_agent_${randomUUID().replaceAll("-", "")}`;
  const buyerA = randomUUID(), buyerB = randomUUID();
  let admin: Pool | undefined;
  let pool: Pool | undefined;
  let repo: PostgresSnapshotRepository;
  let schemaCreated = false;

  function payload(id: string, amount: number) {
    return {
      id, sourceUrl: "https://example.test/pricing",
      capturedAt: "2026-11-11T15:00:00.000Z", coverage: "partial",
      plans: [{ id: "basic", name: "Basic", amount, currency: "USD",
        interval: "month", evidence: { text: String(amount), token: String(amount) } }],
    };
  }

  async function insert(owner: string, id: string, amount: number) {
    await pool!.query(
      "INSERT INTO as_snapshots (buyer_id, id, payload) VALUES ($1, $2, $3::jsonb)",
      [owner, id, JSON.stringify(payload(id, amount))],
    );
  }

  beforeAll(async () => {
    admin = new Pool({ connectionString: databaseUrl, max: 1,
      connectionTimeoutMillis: 5000, statement_timeout: 10000 });
    // Identifier generated locally, never from request input.
    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    pool = new Pool({ connectionString: databaseUrl, max: 3,
      connectionTimeoutMillis: 5000, statement_timeout: 10000,
      options: `-c search_path=${schema}` });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const sql = readFileSync(new URL("../../migrations/001_agent_service_snapshots.sql", import.meta.url), "utf8");
      await client.query(sql);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
    await pool.query(
      "INSERT INTO as_buyers (id, issuer, subject) VALUES ($1, $3, 'a'), ($2, $3, 'b')",
      [buyerA, buyerB, "https://issuer.example.test"],
    );
    await insert(buyerA, "before", 10);
    await insert(buyerA, "after", 20);
    await insert(buyerB, "before", 100);
    await insert(buyerB, "after", 200);
    await insert(buyerB, "b-only", 300);
    repo = new PostgresSnapshotRepository(pool);
  }, 30000);

  afterAll(async () => {
    try { if (pool) await pool.end(); }
    finally {
      if (admin) {
        try { if (schemaCreated) await admin.query(`DROP SCHEMA "${schema}" CASCADE`); }
        finally { await admin.end(); }
      }
    }
  }, 30000);

  it("returns only A's snapshots even when B uses identical snapshot IDs", async () => {
    const result = await repo.findOwnedPair(buyerA, "before", "after");
    expect(result?.before.buyerId).toBe(buyerA);
    expect(result?.after.snapshot.plans[0].amount).toBe(20);
  });
  it("returns B's distinct records under B's scope", async () => {
    const result = await repo.findOwnedPair(buyerB, "before", "after");
    expect(result?.before.snapshot.plans[0].amount).toBe(100);
    expect(result?.after.snapshot.plans[0].amount).toBe(200);
  });
  it("does not return a mixed A/B pair", async () => {
    expect(await repo.findOwnedPair(buyerA, "before", "b-only")).toBeNull();
  });
  it("treats inaccessible and absent records identically", async () => {
    expect(await repo.findOwnedPair(buyerA, "b-only", "after")).toBeNull();
    expect(await repo.findOwnedPair(buyerA, "missing", "after")).toBeNull();
  });
  it("returns no pair for an unknown buyer", async () => {
    expect(await repo.findOwnedPair(randomUUID(), "before", "after")).toBeNull();
  });
  it("rejects injected identifiers without exposing SQL errors", async () => {
    await expect(repo.findOwnedPair(buyerA, "before' OR 1=1 --", "after"))
      .rejects.toThrow(/^snapshot_repository_failed$/);
  });
  it("defaults producer trust to false and compares actual stored records", async () => {
    const result = await repo.findOwnedPair(buyerA, "before", "after");
    expect(result).not.toBeNull();
    expect(result!.after.completeCoverageVerified).toBe(false);
    expect(compareSnapshots(result!.before.snapshot, result!.after.snapshot,
      { beforeCompleteTrusted: result!.before.completeCoverageVerified,
        afterCompleteTrusted: result!.after.completeCoverageVerified })
      .map(change => change.kind)).toEqual(["price_changed"]);
  });
  it("enforces duplicate IDs per buyer in PostgreSQL", async () => {
    await expect(insert(buyerA, "before", 5)).rejects.toMatchObject({ code: "23505" });
  });
  it("enforces buyer foreign keys in PostgreSQL", async () => {
    await expect(insert(randomUUID(), "orphan", 5)).rejects.toMatchObject({ code: "23503" });
  });
  it("enforces row/payload ID agreement", async () => {
    await expect(pool!.query(
      "INSERT INTO as_snapshots (buyer_id, id, payload) VALUES ($1, $2, $3::jsonb)",
      [buyerA, "wrong-id", JSON.stringify(payload("different", 10))],
    )).rejects.toMatchObject({ code: "23514" });
  });
  it("rejects trusted complete metadata on a partial payload", async () => {
    await expect(pool!.query(
      "INSERT INTO as_snapshots (buyer_id, id, payload, complete_coverage_verified) VALUES ($1, $2, $3::jsonb, true)",
      [buyerA, "bad-trust", JSON.stringify(payload("bad-trust", 10))],
    )).rejects.toMatchObject({ code: "23514" });
  });
  it("redacts malformed stored payload errors", async () => {
    await pool!.query(
      "INSERT INTO as_snapshots (buyer_id, id, payload) VALUES ($1, 'malformed', $2::jsonb)",
      [buyerA, JSON.stringify({ id: "malformed", sensitive: "not-for-errors" })],
    );
    await expect(repo.findOwnedPair(buyerA, "malformed", "after"))
      .rejects.toThrow(/^snapshot_repository_failed$/);
  });
});
