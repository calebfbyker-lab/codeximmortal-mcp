import { describe, expect, it } from "vitest";
import type { Pool } from "pg";
import type { Principal } from "./api.js";
import { composeCommerceWorkerProviders, commerceWorkerFromEnvironment } from "./commerce-worker.js";

const principal: Principal = { buyerId: "00000000-0000-4000-8000-000000000001", clientId: "agent", scopes: ["services:execute"] };
const payload = (id: string) => ({
  id, sourceUrl: "https://example.test/pricing", capturedAt: "2026-11-12T13:00:00.000Z", coverage: "partial",
  plans: [{ id: "basic", name: "Basic", amount: 10, currency: "USD", interval: "month", evidence: { text: "10", token: "10", sourceStart: 0, sourceEnd: 2 } }],
});

function repositoryPool(rows: unknown) {
  return {
    query: async () => ({ rows, rowCount: Array.isArray(rows) ? rows.length : 0 }),
    connect: async () => { throw new Error("unused_in_unit_test"); },
  } as never as Pool;
}

describe("commerce worker entrypoint environment contract", () => {
  it("refuses to start unless explicitly enabled", () => {
    expect(() => commerceWorkerFromEnvironment({})).toThrow("commerce_worker_disabled");
  });
  it("requires the reviewed authority contract acknowledgement", () => {
    expect(() => commerceWorkerFromEnvironment({ AGENT_COMMERCE_WORKER_ENABLED: "true" })).toThrow("authority_contract_not_reviewed");
  });
  it("requires the commerce database URL when enabled", () => {
    expect(() => commerceWorkerFromEnvironment({
      AGENT_COMMERCE_WORKER_ENABLED: "true",
      AGENT_COMMERCE_AUTHORITY_CONTRACT: "postgres-commerce-v1-reviewed",
    })).toThrow("missing_configuration:AGENT_COMMERCE_DATABASE_URL");
  });
});

describe("composed production providers", () => {
  it("fails closed for document_extract with no provider implementation", async () => {
    const providers = composeCommerceWorkerProviders(repositoryPool([]));
    await expect(providers.extract(principal, "doc", ["name"])).rejects.toMatchObject({ code: "service_disabled" });
  });
  it("maps a single repository read to a snapshot read with verified coverage", async () => {
    const value = payload("before");
    const providers = composeCommerceWorkerProviders(repositoryPool([
      { buyer_id: principal.buyerId, before_payload: value, after_payload: value, before_verified: true, after_verified: true },
    ]));
    expect(await providers.snapshot(principal, "before")).toEqual({ value, completeTrusted: true });
  });
  it("maps a consistent repository pair to both snapshot reads", async () => {
    const before = payload("before"), after = payload("after");
    const providers = composeCommerceWorkerProviders(repositoryPool([
      { buyer_id: principal.buyerId, before_payload: before, after_payload: after, before_verified: false, after_verified: true },
    ]));
    expect(await providers.snapshotPair!(principal, "before", "after")).toEqual({
      before: { value: before, completeTrusted: false }, after: { value: after, completeTrusted: true },
    });
  });
  it("returns null for a missing single read instead of inventing a snapshot", async () => {
    const providers = composeCommerceWorkerProviders(repositoryPool([]));
    expect(await providers.snapshot(principal, "missing")).toBeNull();
  });
});
