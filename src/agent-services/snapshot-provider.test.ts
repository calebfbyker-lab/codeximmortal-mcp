import { describe, expect, it } from "vitest";
import { executeService, type Providers } from "../agent-commerce/worker.js";
import type { Principal } from "../agent-commerce/api.js";
import { SnapshotProvider, type SafePageFetch, type SnapshotProvenance, type SnapshotSink, type SnapshotSourceStore } from "./snapshot-provider.js";

const principal: Principal = { buyerId: "buyer-1", clientId: "client-1", scopes: ["services:execute"] };
const COMPLETE = JSON.stringify({ offers: [
  { name: "Pro", amount: 10, currency: "USD", interval: "month" },
  { name: "Max", amount: 99.5, currency: "USD", interval: "month" }] });
const PARTIAL = JSON.stringify({ offers: [{ name: "Pro", amount: null, currency: null, interval: null }] });

function setup(body: string, owned = true) {
  const fetched: string[] = [];
  const persisted: Array<{ buyerId: string; snapshot: unknown; provenance: SnapshotProvenance }> = [];
  const sources: SnapshotSourceStore = {
    findOwnedSource: async (buyerId, sourceId) => buyerId === "buyer-1" && sourceId === "src-1" && owned
      ? { buyerId, sourceId, url: "https://example.test/pricing", approvedForCapture: owned } : null,
  };
  const fetcher: SafePageFetch = { fetch: async url => { fetched.push(url);
    return { body, contentType: "application/json" }; } };
  const sink: SnapshotSink = { persist: async (snapshot, buyerId, provenance) => {
    persisted.push({ buyerId, snapshot, provenance }); } };
  const clock = () => new Date("2026-11-13T14:00:00.000Z");
  const provider = new SnapshotProvider(sources, fetcher, sink, clock);
  const providers: Providers = {
    capture: (p, id, context) => provider.capture(p, id, context),
    snapshot: async () => null,
    extract: async () => { throw new Error("not_used"); },
  };
  return { provider, providers, fetched, persisted };
}

describe("snapshot provider vertical slice", () => {
  it("captures an owned approved source through executeService and persists evidence", async () => {
    const f = setup(COMPLETE);
    const value = await executeService(f.providers, principal, "pricing_snapshot",
      { sourceId: "src-1" }, { jobId: "job-1", attempt: 1, signal: new AbortController().signal });
    expect(value).toMatchObject({ id: "snap-job-1", sourceUrl: "https://example.test/pricing",
      coverage: "complete", plans: [{ amount: 10 }, { amount: 99.5 }] });
    expect(f.fetched).toEqual(["https://example.test/pricing"]);
    expect(f.persisted).toHaveLength(1);
    expect(f.persisted[0].buyerId).toBe("buyer-1");
    expect(f.persisted[0].provenance.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(f.persisted[0].provenance.extractedPlans).toBe(2);
    expect(f.persisted[0].provenance.rawContentType).toBe("application/json");
  });
  it("rejects unowned or unapproved sources without fetching", async () => {
    const f = setup(COMPLETE, false);
    await expect(executeService(f.providers, principal, "pricing_snapshot",
      { sourceId: "src-1" }, { jobId: "job-2", attempt: 1, signal: new AbortController().signal }))
      .rejects.toMatchObject({ status: 404, code: "not_found" });
    expect(f.fetched).toHaveLength(0); expect(f.persisted).toHaveLength(0);
  });
  it("rejects oversized source content as a terminal provider error", async () => {
    const f = setup(" ".repeat(513 * 1024));
    await expect(executeService(f.providers, principal, "pricing_snapshot",
      { sourceId: "src-1" }, { jobId: "job-3", attempt: 1, signal: new AbortController().signal }))
      .rejects.toMatchObject({ status: 422, code: "source_too_large" });
    expect(f.persisted).toHaveLength(0);
  });
  it("rejects invalid source content without persisting", async () => {
    const f = setup("not json at all");
    await expect(executeService(f.providers, principal, "pricing_snapshot",
      { sourceId: "src-1" }, { jobId: "job-4", attempt: 1, signal: new AbortController().signal }))
      .rejects.toMatchObject({ status: 422, code: "invalid_source_content" });
    expect(f.persisted).toHaveLength(0);
  });
  it("keeps partial coverage explicit with null evidence for unknown amounts", async () => {
    const f = setup(PARTIAL);
    const value = await executeService(f.providers, principal, "pricing_snapshot",
      { sourceId: "src-1" }, { jobId: "job-5", attempt: 1, signal: new AbortController().signal });
    expect(value).toMatchObject({ coverage: "partial" });
    expect((value as { plans: Array<{ amount: number | null; evidence: unknown }> }).plans[0]).toMatchObject({ amount: null, evidence: null });
    expect(f.persisted[0].provenance.extractedPlans).toBe(1);
  });
  it("honors cancellation before fetch", async () => {
    const f = setup(COMPLETE);
    const controller = new AbortController(); controller.abort();
    await expect(f.provider.capture(principal, "src-1",
      { jobId: "job-6", attempt: 1, signal: controller.signal })).rejects.toThrow();
    expect(f.fetched).toHaveLength(0); expect(f.persisted).toHaveLength(0);
  });
});
