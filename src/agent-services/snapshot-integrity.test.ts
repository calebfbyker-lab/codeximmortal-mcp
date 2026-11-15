import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { buildSnapshot, extractPlans, ProviderRejectedError, type SnapshotProvenance } from "./snapshot-provider.js";
import { validateAmountEvidence } from "./evidence.js";
import { PostgresSnapshotSink, SnapshotSinkError } from "../persistence/postgres-snapshot-sink.js";
import { executeService, type Providers } from "../agent-commerce/worker.js";
import type { Comparison, Snapshot } from "./contracts.js";
import type { Principal } from "../agent-commerce/api.js";

const planId = (name: string) => "plan-" + createHash("sha256").update(name).digest("hex").slice(0, 12);
const source = { buyerId: "11111111-1111-4111-8111-111111111111", sourceId: "src-1", url: "https://example.test/plans", approvedForCapture: true };
const principal = { buyerId: source.buyerId } as unknown as Principal;
const asPool = (connect: () => Promise<unknown>) => ({ connect } as unknown as Pick<Pool, "connect">);

function makeSnapshot(body: string, id: string, at: Date): Snapshot {
  return buildSnapshot(source, { body, contentType: "application/json" }, id, at);
}

const offersBody = (plans: Array<{ name: string; amount: number | null }>) =>
  JSON.stringify(plans.map(plan => ({ name: plan.name, amount: plan.amount, currency: "USD", interval: "month" })));

describe("original-source evidence (P0 item 1)", () => {
  it("uses the original body slice as evidence, never a regenerated string", () => {
    const body = '  [ {"name":"Pro","amount":49,"currency":"USD","interval":"month"} , {"name":"Team","amount":99,"currency":"USD","interval":"month"} ] ';
    const snapshot = makeSnapshot(body, "snap-1", new Date("2026-11-01T00:00:00.000Z"));
    expect(snapshot.plans).toHaveLength(2);
    for (const plan of snapshot.plans) {
      const evidence = plan.evidence!;
      expect(evidence.text).toContain('"name":"' + plan.name + '"');
      expect(evidence.text.startsWith("name=")).toBe(false);
      expect(body.slice(evidence.sourceStart, evidence.sourceEnd)).toBe(evidence.text);
      expect(evidence.sourceStart).toBeGreaterThanOrEqual(0);
      expect(evidence.sourceEnd).toBeGreaterThan(evidence.sourceStart);
    }
  });

  it("pairs parsed offers with original spans and rejects misaligned structures", () => {
    const body = '{"offers":[{"name":"A","amount":5,"currency":"USD","interval":"month"}]}';
    const plans = extractPlans(body);
    expect(plans).toHaveLength(1);
    expect(body.slice(plans[0].sourceStart, plans[0].sourceEnd)).toBe(plans[0].excerpt);
    expect(extractPlans("[]")).toEqual([]);
    expect(extractPlans("{}")).toEqual([]);
    const duplicate = '{"offers":[{"name":"A","amount":5,"currency":"USD","interval":"month"}],"offers":[{"name":"B","amount":6,"currency":"USD","interval":"month"}]}';
    expect(() => extractPlans(duplicate)).toThrow(ProviderRejectedError);
  });

  it("validates amount evidence with span fields and rejects the old shape", () => {
    expect(validateAmountEvidence(10, { text: '{"amount":10}', token: "10", sourceStart: 0, sourceEnd: 12 })).toEqual({ text: '{"amount":10}', token: "10", sourceStart: 0, sourceEnd: 12 });
    expect(() => validateAmountEvidence(10, { text: '{"amount":10}', token: "10" })).toThrow();
    expect(() => validateAmountEvidence(10, { text: "costs 100 dollars", token: "10", sourceStart: 0, sourceEnd: 17 })).toThrow("amount_evidence_mismatch");
    expect(() => validateAmountEvidence(10, { text: '{"amount":10}', token: "10", sourceStart: 5, sourceEnd: 5 })).toThrow("invalid_evidence_span");
    expect(() => validateAmountEvidence(10, { text: "Price: -10 minus ten", token: "10", sourceStart: 0, sourceEnd: 20 })).toThrow("amount_evidence_mismatch");
  });

  it("never stalls on a negative number run", () => {
    expect(() => validateAmountEvidence(10, { text: "Price: -10 minus ten", token: "10", sourceStart: 0, sourceEnd: 20 })).toThrow("amount_evidence_mismatch");
    expect(validateAmountEvidence(10, { text: "between -10 and 10 units", token: "10", sourceStart: 0, sourceEnd: 24 }).token).toBe("10");
  });
});

describe("stable plan identity (P0 item 2)", () => {
  it("keeps ids stable under reordering and across price changes", () => {
    const before = makeSnapshot(offersBody([{ name: "Starter", amount: 10 }, { name: "Pro", amount: 49 }]), "snap-a", new Date("2026-11-01T00:00:00.000Z"));
    const after = makeSnapshot(offersBody([{ name: "Pro", amount: 59 }, { name: "Starter", amount: 12 }]), "snap-b", new Date("2026-11-02T00:00:00.000Z"));
    expect(before.plans.map(p => p.id).sort()).toEqual(after.plans.map(p => p.id).sort());
    const beforeById = new Map(before.plans.map(p => [p.name, p.id]));
    const afterById = new Map(after.plans.map(p => [p.name, p.id]));
    expect(afterById.get("Starter")).toBe(beforeById.get("Starter"));
    expect(afterById.get("Pro")).toBe(beforeById.get("Pro"));
    expect(beforeById.get("Starter")).toBe(planId("Starter"));
  });

  it("gives duplicate names distinct, order-independent ids", () => {
    const first = makeSnapshot(offersBody([{ name: "Pro", amount: 5 }, { name: "Pro", amount: 9 }]), "snap-a", new Date("2026-11-01T00:00:00.000Z"));
    const reordered = makeSnapshot(offersBody([{ name: "Pro", amount: 9 }, { name: "Pro", amount: 5 }]), "snap-b", new Date("2026-11-02T00:00:00.000Z"));
    const byName = (snapshot: Snapshot) => new Map(snapshot.plans.map(p => [p.amount, p.id]));
    expect(byName(first).get(5)).toBe(byName(reordered).get(5));
    expect(byName(first).get(9)).toBe(byName(reordered).get(9));
    expect(new Set(first.plans.map(p => p.id)).size).toBe(2);
  });
});

class FakeClient {
  statements: string[] = [];
  released = false;
  constructor(private readonly payloadRow: unknown, private readonly provenanceRow: Record<string, unknown> | null) {}
  async query(sql: string) {
    this.statements.push(sql);
    if (sql.startsWith("BEGIN") || sql.startsWith("COMMIT") || sql.startsWith("ROLLBACK")) return { rows: [], rowCount: 0 };
    if (sql.includes("INSERT INTO as_snapshots")) return { rows: [], rowCount: 1 };
    if (sql.includes("INSERT INTO as_snapshot_provenance")) return { rows: [], rowCount: 1 };
    if (sql.includes("SELECT payload")) return { rows: [{ payload: this.payloadRow }], rowCount: 1 };
    if (sql.includes("SELECT source_id, content_sha256")) return { rows: this.provenanceRow ? [this.provenanceRow] : [], rowCount: this.provenanceRow ? 1 : 0 };
    throw new Error("unexpected sql");
  }
  release() { this.released = true; }
}

const provenance: SnapshotProvenance = {
  sourceId: "src-1", contentSha256: "a".repeat(64), fetchBytes: 120, extractedPlans: 1, rawContentType: "application/json",
};
const provenanceRow = {
  source_id: "src-1", content_sha256: "a".repeat(64), fetch_bytes: 120, extracted_plans: 1, raw_content_type: "application/json",
};

describe("sink retry agreement (P0 item 2)", () => {
  it("commits when the persisted payload agrees with the retry", async () => {
    const snapshot = makeSnapshot(offersBody([{ name: "Pro", amount: 49 }]), "snap-1", new Date("2026-11-01T00:00:00.000Z"));
    const client = new FakeClient(snapshot, provenanceRow);
    const sink = new PostgresSnapshotSink(asPool(async () => client));
    await sink.persist(snapshot, source.buyerId, provenance);
    expect(client.statements.some(s => s.startsWith("COMMIT"))).toBe(true);
    expect(client.released).toBe(true);
  });

  it("matches a stored payload with reordered jsonb keys", async () => {
    const snapshot = makeSnapshot(offersBody([{ name: "Pro", amount: 49 }]), "snap-1", new Date("2026-11-01T00:00:00.000Z"));
    const reordered = { plans: snapshot.plans, coverage: snapshot.coverage, capturedAt: snapshot.capturedAt, sourceUrl: snapshot.sourceUrl, id: snapshot.id };
    const client = new FakeClient(reordered, provenanceRow);
    const sink = new PostgresSnapshotSink(asPool(async () => client));
    await expect(sink.persist(snapshot, source.buyerId, provenance)).resolves.toBeUndefined();
  });

  it("rolls back when a retry disagrees with the persisted payload", async () => {
    const snapshot = makeSnapshot(offersBody([{ name: "Pro", amount: 49 }]), "snap-1", new Date("2026-11-01T00:00:00.000Z"));
    const different = makeSnapshot(offersBody([{ name: "Pro", amount: 59 }]), "snap-1", new Date("2026-11-02T00:00:00.000Z"));
    const client = new FakeClient(different, provenanceRow);
    const sink = new PostgresSnapshotSink(asPool(async () => client));
    await expect(sink.persist(snapshot, source.buyerId, provenance)).rejects.toThrow(SnapshotSinkError);
    expect(client.statements.some(s => s.startsWith("ROLLBACK"))).toBe(true);
    expect(client.statements.some(s => s.startsWith("COMMIT"))).toBe(false);
  });

  it("rolls back when stored provenance disagrees", async () => {
    const snapshot = makeSnapshot(offersBody([{ name: "Pro", amount: 49 }]), "snap-1", new Date("2026-11-01T00:00:00.000Z"));
    const client = new FakeClient(snapshot, { ...provenanceRow, content_sha256: "b".repeat(64) });
    const sink = new PostgresSnapshotSink(asPool(async () => client));
    await expect(sink.persist(snapshot, source.buyerId, provenance)).rejects.toThrow(SnapshotSinkError);
  });

  it("rejects malformed identities before connecting", async () => {
    const snapshot = makeSnapshot(offersBody([{ name: "Pro", amount: 49 }]), "snap-1", new Date("2026-11-01T00:00:00.000Z"));
    let connected = false;
    const sink = new PostgresSnapshotSink(asPool(async () => {
      connected = true;
      return new FakeClient(snapshot, provenanceRow);
    }));
    await expect(sink.persist(snapshot, "not-a-uuid", provenance)).rejects.toThrow(SnapshotSinkError);
    expect(connected).toBe(false);
  });
});

describe("consistent paired reads (P0 item 3)", () => {
  const before = () => makeSnapshot(offersBody([{ name: "Starter", amount: 10 }, { name: "Pro", amount: 49 }]), "snap-a", new Date("2026-11-01T00:00:00.000Z"));
  const after = () => makeSnapshot(offersBody([{ name: "Starter", amount: 12 }]), "snap-b", new Date("2026-11-02T00:00:00.000Z"));
  const unused = { capture: async () => { throw new Error("unused"); }, extract: async () => { throw new Error("unused"); } };

  it("prefers a single consistent pair read and reports price changes", async () => {
    let pairCalls = 0, singleCalls = 0;
    const providers: Providers = {
      ...unused,
      snapshot: async () => { singleCalls++; return null; },
      snapshotPair: async () => { pairCalls++; return { before: { value: before(), completeTrusted: true }, after: { value: after(), completeTrusted: true } }; },
    };
    const result = await executeService(providers, principal, "pricing_compare", { beforeId: "snap-a", afterId: "snap-b" }) as Comparison[];
    expect(pairCalls).toBe(1);
    expect(singleCalls).toBe(0);
    expect(result.some(c => c.kind === "price_changed" && c.planId === planId("Starter"))).toBe(true);
  });

  it("accepts the sequential fallback when re-reads are stable", async () => {
    let reads = 0;
    const providers: Providers = {
      ...unused,
      snapshot: async (_p, id) => {
        reads++;
        return id === "snap-a" ? { value: before(), completeTrusted: true } : { value: after(), completeTrusted: true };
      },
    };
    const result = await executeService(providers, principal, "pricing_compare", { beforeId: "snap-a", afterId: "snap-b" }) as Comparison[];
    expect(reads).toBe(4);
    expect(result.some(c => c.kind === "price_changed")).toBe(true);
  });

  it("fails closed on read drift between the pair and the verification read", async () => {
    let calls = 0;
    const providers: Providers = {
      ...unused,
      snapshot: async (_p, id) => {
        calls++;
        if (id === "snap-a" && calls > 2) return null;
        return id === "snap-a" ? { value: before(), completeTrusted: true } : { value: after(), completeTrusted: true };
      },
    };
    await expect(executeService(providers, principal, "pricing_compare", { beforeId: "snap-a", afterId: "snap-b" })).rejects.toThrow();
  });

  it("never infers removal from unverified complete coverage", async () => {
    const providers: Providers = {
      ...unused,
      snapshot: async () => { throw new Error("unused"); },
      snapshotPair: async () => ({ before: { value: before(), completeTrusted: true }, after: { value: after(), completeTrusted: false } }),
    };
    const result = await executeService(providers, principal, "pricing_compare", { beforeId: "snap-a", afterId: "snap-b" }) as Comparison[];
    const pro = result.find(c => c.planId === planId("Pro"));
    expect(pro?.kind).toBe("plan_not_observed");
    const trusted: Providers = {
      ...unused,
      snapshot: async () => { throw new Error("unused"); },
      snapshotPair: async () => ({ before: { value: before(), completeTrusted: true }, after: { value: after(), completeTrusted: true } }),
    };
    const trustedResult = await executeService(trusted, principal, "pricing_compare", { beforeId: "snap-a", afterId: "snap-b" }) as Comparison[];
    expect(trustedResult.find(c => c.planId === planId("Pro"))?.kind).toBe("plan_removed");
  });
});
