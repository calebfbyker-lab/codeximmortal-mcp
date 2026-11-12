import { describe, it, expect, vi } from "vitest";
import { invoke, invokeMcp, validateInput, digest, type Dependencies } from "./api.js";
import { createIntrospector } from "./introspection.js";
function dependencies(): Dependencies {
  return { enabled: true, authenticate: vi.fn(async () => ({ buyerId: "buyer-a", clientId: "agent-a", scopes: ["commerce:quote", "services:execute", "jobs:read", "results:read"] })), consume: vi.fn(async () => ({ allowed: true, retryAfter: 0 })), backend: {
    quote: vi.fn(async () => ({ id: "quote-1" })), submit: vi.fn(async () => ({ id: "job-1", status: "queued" })), job: vi.fn(async () => null), result: vi.fn(async () => null)
  } };
}
const input = { service: "pricing_snapshot", input: { sourceId: "source-1" }, quoteId: "quote-1" };
describe("agent commerce boundary", () => {
  it("fails closed when disabled", async () => { const d = dependencies(); d.enabled = false; await expect(invoke(d, "x", "submit", input)).rejects.toMatchObject({ status: 503 }); expect(d.authenticate).not.toHaveBeenCalled(); });
  it("requires bearer", async () => { await expect(invoke(dependencies(), "", "quote", {})).rejects.toMatchObject({ status: 401 }); });
  it("requires scope", async () => { const d = dependencies(); d.authenticate = async () => ({ buyerId: "a", clientId: "b", scopes: [] }); await expect(invoke(d, "x", "quote", {})).rejects.toMatchObject({ status: 403 }); });
  it("enforces quota before backend", async () => { const d = dependencies(); d.consume = async () => ({ allowed: false, retryAfter: 12 }); await expect(invoke(d, "x", "submit", input, "abcdefghijklmnop")).rejects.toMatchObject({ status: 429, retryAfter: 12 }); expect(d.backend.submit).not.toHaveBeenCalled(); });
  it("rejects claimed buyer", () => { expect(() => validateInput("pricing_snapshot", { sourceId: "s", buyerId: "victim" })).toThrow(); });
  it("rejects URL source IDs", () => { expect(() => validateInput("pricing_snapshot", { sourceId: "http://127.0.0.1" })).toThrow(); });
  it("requires idempotency key", async () => { await expect(invoke(dependencies(), "x", "submit", input)).rejects.toMatchObject({ status: 400 }); });
  it("passes authenticated buyer and digest", async () => { const d = dependencies(); await invoke(d, "x", "submit", input, "abcdefghijklmnop"); expect(d.backend.submit).toHaveBeenCalledWith(expect.objectContaining({ buyerId: "buyer-a" }), expect.objectContaining({ digest: digest(input), idempotencyKey: "abcdefghijklmnop" })); });
  it("does not distinguish foreign lookup absence", async () => { await expect(invoke(dependencies(), "x", "result", { id: "foreign" })).rejects.toMatchObject({ status: 404 }); });
  it("bounds unique extraction fields", () => { for (const fields of [[], ["same", "same"], Array(101).fill("a")]) expect(() => validateInput("document_extract", { documentId: "d", profile: "scalar-fields-v1", fields })).toThrow(); });
  it("canonicalizes key order", () => { expect(digest({ a: 1, b: 2 })).toBe(digest({ b: 2, a: 1 })); });
  it("maps all service tools through shared admission", async () => { for (const [tool, body] of Object.entries({ codex_pricing_snapshot: { sourceId: "s" }, codex_pricing_compare: { beforeId: "a", afterId: "b" }, codex_document_extract: { documentId: "d", profile: "scalar-fields-v1", fields: ["total"] } })) { const d = dependencies(); await invokeMcp(d, "x", tool, { input: body, quoteId: "q" }, "abcdefghijklmnop"); expect(d.backend.submit).toHaveBeenCalledTimes(1); } });
});
describe("OAuth introspection", () => {
  const config = { endpoint: "https://auth.example/introspect", clientId: "server", clientSecret: "test-only", audience: "https://mcp.example/mcp", issuer: "https://auth.example" };
  const claims = { active: true, iss: config.issuer, aud: config.audience, sub: "buyer", client_id: "agent", scope: "services:execute", exp: 4102444800, token_type: "Bearer" };
  it("accepts active audience-bound bearer", async () => { const f = (async () => new Response(JSON.stringify(claims))) as typeof fetch; expect(await createIntrospector(config, f)("access")).toMatchObject({ buyerId: "buyer" }); });
  it.each([{ aud: "other" }, { exp: 1 }, { active: false }, { iss: "other" }, { token_type: "ID" }])("rejects invalid claims %j", async patch => { const f = (async () => new Response(JSON.stringify({ ...claims, ...patch }))) as typeof fetch; await expect(createIntrospector(config, f)("access")).rejects.toMatchObject({ status: 401 }); });
  it("redacts provider outage", async () => { const f = (async () => { throw new Error("private details"); }) as typeof fetch; await expect(createIntrospector(config, f)("access")).rejects.toMatchObject({ status: 503, code: "auth_unavailable" }); });
});
