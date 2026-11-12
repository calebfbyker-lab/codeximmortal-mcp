import { describe, it, expect, vi } from "vitest";
import { createBase44Dependencies } from "./base44-authority.js";
import { agentCommerceFromEnvironment } from "./runtime.js";
import { digest } from "./api.js";
const buyer = "11111111-1111-4111-8111-111111111111";
const principal = { buyerId: buyer, clientId: "agent", scopes: ["services:execute"] };
function setup(data: unknown, status = 200) {
  const request = vi.fn(async (_url: unknown, _init?: RequestInit) => new Response(JSON.stringify({ version: "agent-commerce-authority-v1", ...(status === 200 ? { data } : { error: data }) }), { status, headers: { "content-type": "application/json" } }));
  const dependencies = createBase44Dependencies({ endpoint: "https://codex-immortal-2c799423.base44.app/functions/test_authority", serviceToken: "synthetic-service-token", issuer: "https://auth.example", authenticateSubject: async () => ({ buyerId: "opaque-sub", clientId: "agent", scopes: ["services:execute", "results:read"] }), consume: async () => ({ allowed: true, retryAfter: 0 }), request: request as unknown as typeof fetch });
  return { dependencies, request };
}
describe("Base44 authority client", () => {
  it("resolves canonical buyer and intersects grants", async () => {
    const { dependencies, request } = setup({ issuer: "https://auth.example", subject: "opaque-sub", clientId: "agent", buyerId: buyer, active: true, scopes: ["services:execute", "admin"] });
    expect(await dependencies.authenticate("client-access-token")).toEqual(principal);
    expect(request.mock.calls[0][1]?.headers).toMatchObject({ Authorization: "Bearer synthetic-service-token" });
    expect(String(request.mock.calls[0][1]?.body)).not.toContain("client-access-token");
  });
  it("rejects mismatched binding", async () => { const { dependencies } = setup({ issuer: "https://auth.example", subject: "different", clientId: "agent", buyerId: buyer, active: true, scopes: [] }); await expect(dependencies.authenticate("x")).rejects.toMatchObject({ status: 503 }); });
  it("rejects a foreign job response", async () => { const { dependencies } = setup({ id: "j", buyerId: "foreign", clientId: "agent", status: "queued" }); await expect(dependencies.backend.job(principal, "j")).rejects.toMatchObject({ status: 503 }); });
  it("turns authoritative absence into null", async () => { const { dependencies } = setup({ code: "not_found" }, 404); expect(await dependencies.backend.job(principal, "j")).toBeNull(); });
  it("does not retry a failed submit", async () => { const { dependencies, request } = setup({ code: "idempotency_conflict" }, 409); const v = { service: "pricing_snapshot" as const, input: { sourceId: "s" }, quoteId: "q" }; await expect(dependencies.backend.submit(principal, { ...v, idempotencyKey: "abcdefghijklmnop", digest: digest(v) })).rejects.toMatchObject({ status: 409 }); expect(request).toHaveBeenCalledTimes(1); });
  it("rejects an expired quote response", async () => { const { dependencies } = setup({ buyerId: buyer, clientId: "agent", service: "pricing_snapshot", inputDigest: digest({ service: "pricing_snapshot", input: { sourceId: "s" } }), id: "q", amountMinor: 1, currency: "USD", expiresAt: "2000-01-01T00:00:00Z" }); await expect(dependencies.backend.quote(principal, "pricing_snapshot", { sourceId: "s" })).rejects.toMatchObject({ status: 503 }); });
  it("redacts unknown authority errors", async () => { const { dependencies } = setup({ code: "private_sql_detail" }, 500); await expect(dependencies.backend.job(principal, "j")).rejects.toMatchObject({ code: "authority_unavailable" }); });
  it("defaults to disabled without secrets", async () => { const runtime = agentCommerceFromEnvironment({}); expect(runtime.dependencies.enabled).toBe(false); await runtime.close(); });
  it("refuses enabled mode without reviewed contract", () => { expect(() => agentCommerceFromEnvironment({ AGENT_COMMERCE_ENABLED: "true" })).toThrow("authority_contract_not_reviewed"); });
});
