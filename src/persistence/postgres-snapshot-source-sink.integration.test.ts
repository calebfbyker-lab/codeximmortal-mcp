import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Principal } from "../agent-commerce/api.js";
import { executeService, type Providers } from "../agent-commerce/worker.js";
import { SnapshotProvider, type SafePageFetch } from "../agent-services/snapshot-provider.js";
import { validateSnapshot } from "../agent-services/pricing-snapshot.js";
import { PostgresSnapshotRepository } from "./postgres-snapshot-repository.js";
import { PostgresSnapshotSink } from "./postgres-snapshot-sink.js";
import { PostgresSnapshotSourceStore } from "./postgres-snapshot-source-store.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (process.env.REQUIRE_DB_TESTS === "true" && !databaseUrl) {
  throw new Error("TEST_DATABASE_URL_required");
}
if (databaseUrl && process.env.CODEX_DB_TEST_ACK !== "disposable-database-only") {
  throw new Error("disposable_database_ack_required");
}

// No URL: explicitly SKIPPED, never a database PASS.
describe.runIf(Boolean(databaseUrl))("PostgreSQL snapshot source store and sink (synthetic fixtures)", () => {
  const schema = `ci_agent_${randomUUID().replaceAll("-", "")}`;
  const buyerA = randomUUID(), buyerB = randomUUID();
  let admin: Pool | undefined;
  let pool: Pool | undefined;
  let repository: PostgresSnapshotRepository;
  let providers: Providers;
  let sink: PostgresSnapshotSink;
  let store: PostgresSnapshotSourceStore;

  function offers(amount: number) {
    return JSON.stringify({ offers: [
      { name: "Pro", amount, currency: "USD", interval: "month" }] });
  }
  const bodies = [offers(10), offers(20)];
  let fetchCount = 0;
  const fetched: string[] = [];
  const fetcher: SafePageFetch = { fetch: async url => {
    fetched.push(url);
    return { body: bodies[Math.min(fetchCount++, bodies.length - 1)], contentType: "application/json" };
  } };

  beforeAll(async () => {
    admin = new Pool({ connectionString: databaseUrl, max: 1,
      connectionTimeoutMillis: 5000, statement_timeout: 10000 });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({ connectionString: databaseUrl, max: 3,
      connectionTimeoutMillis: 5000, statement_timeout: 10000,
      options: `-c search_path=${schema}` });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const file of ["001_agent_service_snapshots.sql", "002_agent_service_sources.sql"]) {
        const sql = readFileSync(new URL(`../../migrations/${file}`, import.meta.url), "utf8");
        await client.query(sql);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
    await pool.query(
      "INSERT INTO as_buyers (id, issuer, subject) VALUES ($1, $3, 'a'), ($2, $3, 'b')",
      [buyerA, buyerB, "https://issuer.example.test"]);
    await pool.query(
      `INSERT INTO as_sources (buyer_id, source_id, url, approved_for_capture) VALUES
         ($1, 'src-approved', 'https://example.test/pricing', true),
         ($1, 'src-unapproved', 'https://example.test/other', false),
         ($2, 'src-approved', 'https://example.test/b-pricing', true)`,
      [buyerA, buyerB]);
    store = new PostgresSnapshotSourceStore(pool);
    sink = new PostgresSnapshotSink(pool);
    repository = new PostgresSnapshotRepository(pool);
    const provider = new SnapshotProvider(store, fetcher, sink,
      () => new Date("2026-11-13T16:00:00.000Z"));
    providers = {
      capture: (p, id, context) => provider.capture(p, id, context),
      snapshot: async () => null,
      extract: async () => { throw new Error("not_used"); },
    };
  }, 30000);

  afterAll(async () => {
    try { if (pool) await pool.end(); }
    finally {
      if (admin) {
        try { await admin.query(`DROP SCHEMA "${schema}" CASCADE`); }
        finally { await admin.end(); }
      }
    }
  }, 30000);

  const principal = (buyer: string): Principal =>
    ({ buyerId: buyer, clientId: "client-1", scopes: ["services:execute"] });
  const signal = () => new AbortController().signal;

  it("resolves only buyer-owned approved sources", async () => {
    const owned = await store.findOwnedSource(buyerA, "src-approved");
    expect(owned).toMatchObject({ buyerId: buyerA, url: "https://example.test/pricing", approvedForCapture: true });
    expect(await store.findOwnedSource(buyerA, "src-unapproved")).toBeNull();
    expect(await store.findOwnedSource(buyerB, "src-approved")).toMatchObject({ url: "https://example.test/b-pricing" });
    expect(await store.findOwnedSource(buyerA, "missing")).toBeNull();
  });

  it("captures through executeService and persists a readable, evidence-backed snapshot", async () => {
    const first = await executeService(providers, principal(buyerA), "pricing_snapshot",
      { sourceId: "src-approved" }, { jobId: "job-before", attempt: 1, signal: signal() });
    expect(first).toMatchObject({ id: "snap-job-before", coverage: "complete" });
    const second = await executeService(providers, principal(buyerA), "pricing_snapshot",
      { sourceId: "src-approved" }, { jobId: "job-after", attempt: 1, signal: signal() });
    expect(second).toMatchObject({ id: "snap-job-after", coverage: "complete" });
    const provenance = await pool!.query(
      "SELECT source_id, content_sha256, fetch_bytes, extracted_plans FROM as_snapshot_provenance WHERE snapshot_id = $1",
      ["snap-job-before"]);
    expect(provenance.rows[0]).toMatchObject({ source_id: "src-approved", extracted_plans: 1 });
    expect(provenance.rows[0].content_sha256).toMatch(/^[a-f0-9]{64}$/);
    // The compare path reads the same persisted rows the provider wrote.
    const pair = await repository.findOwnedPair(buyerA, "snap-job-before", "snap-job-after");
    expect(pair?.before.snapshot.plans[0].amount).toBe(10);
    expect(pair?.after.snapshot.plans[0].amount).toBe(20);
    expect(pair?.after.completeCoverageVerified).toBe(true);
  });

  it("re-persisting the same snapshot is idempotent", async () => {
    const repeat = await executeService(providers, principal(buyerA), "pricing_snapshot",
      { sourceId: "src-approved" }, { jobId: "job-before", attempt: 2, signal: signal() });
    expect(repeat).toMatchObject({ id: "snap-job-before" });
    const count = await pool!.query(
      "SELECT count(*)::int AS n FROM as_snapshots WHERE id = $1", ["snap-job-before"]);
    expect(count.rows[0].n).toBe(1);
  });

  it("keeps buyer isolation at the store level", async () => {
    await expect(executeService(providers, principal(buyerB), "pricing_snapshot",
      { sourceId: "src-unapproved" }, { jobId: "job-b1", attempt: 1, signal: signal() }))
      .rejects.toMatchObject({ status: 404, code: "not_found" });
    const bCapture = await executeService(providers, principal(buyerB), "pricing_snapshot",
      { sourceId: "src-approved" }, { jobId: "job-b2", attempt: 1, signal: signal() });
    expect(bCapture).toMatchObject({ id: "snap-job-b2", sourceUrl: "https://example.test/b-pricing" });
  });

  const partial = validateSnapshot({ id: "snap-orphan",
    sourceUrl: "https://example.test/pricing",
    capturedAt: "2026-11-13T16:00:00.000Z", coverage: "partial", plans: [] });
  const provenance = { sourceId: "src-approved", contentSha256: "0".repeat(64),
    fetchBytes: 10, extractedPlans: 0, rawContentType: "application/json" };

  it("enforces snapshot and provenance foreign keys in PostgreSQL", async () => {
    await expect(sink.persist(partial, randomUUID(), provenance))
      .rejects.toThrow(/^snapshot_sink_failed$/);
  });

  it("rejects malformed identifiers without exposing SQL errors", async () => {
    await expect(store.findOwnedSource(buyerA, "src' OR 1=1 --"))
      .rejects.toThrow(/^snapshot_source_store_failed$/);
    await expect(sink.persist(partial, "not-a-uuid", provenance))
      .rejects.toThrow(/^snapshot_sink_failed$/);
  });
});
