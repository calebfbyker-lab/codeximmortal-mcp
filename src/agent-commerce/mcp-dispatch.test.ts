import { describe, expect, it, vi } from "vitest";
import { ApiError, type Dependencies, type Principal, type Service } from "./api.js";
import { createRequestDispatcher } from "./mcp-dispatch.js";

const scopes = ["commerce:quote", "services:execute", "jobs:read", "results:read"];
const quote = { service: "pricing_snapshot", input: { sourceId: "source-1" } };
const submit = { input: quote.input, quoteId: "quote-1", idempotencyKey: "request_key_00001" };
function fixture() {
  const authenticate = vi.fn(async (token: string): Promise<Principal> => {
    if (token === "invalid") throw new ApiError(401, "unauthorized");
    return { buyerId: token, clientId: "client", scopes: [...scopes] };
  });
  const backend = {
    quote: vi.fn(async (p: Principal, _s: Service, _v: Record<string, unknown>) => ({ buyerId: p.buyerId })),
    submit: vi.fn(async (_p: Principal, v: Parameters<Dependencies["backend"]["submit"]>[1]) => ({ id: v.idempotencyKey })),
    job: vi.fn(async (p: Principal, _id: string) => ({ buyerId: p.buyerId })),
    result: vi.fn(async (p: Principal, _id: string) => ({ buyerId: p.buyerId })),
  };
  const d: Dependencies = { enabled: true, authenticate,
    consume: vi.fn(async () => ({ allowed: true, retryAfter: 0 })), backend };
  const fallback = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({ catalog: true }));
  const dispatch = (headers: string[] = ["Authorization", "Bearer buyer-A"]) =>
    createRequestDispatcher(d, headers, fallback);
  return { d, authenticate, backend, fallback, dispatch };
}

describe("request-scoped commerce dispatch", () => {
  it.each([
    { headers: [] }, { headers: ["Authorization", "Basic x"] },
    { headers: ["Authorization", "Bearer a b"] },
    { headers: ["Authorization", "Bearer a", "authorization", "Bearer b"] },
    { headers: ["Authorization", "Bearer " + "x".repeat(8193)] },
  ])("rejects invalid headers without gateway fallback: $headers", async ({ headers }) => {
    const f = fixture();
    await expect(f.dispatch(headers)("codex_service_quote", quote)).rejects.toMatchObject({ code: "unauthorized" });
    expect(f.authenticate).not.toHaveBeenCalled();
    expect(f.fallback).not.toHaveBeenCalled();
  });
  it("rejects invalid credentials without gateway fallback", async () => {
    const f = fixture();
    await expect(f.dispatch(["authorization", "Bearer invalid"])("codex_service_quote", quote)).rejects.toMatchObject({ code: "unauthorized" });
    expect(f.backend.quote).not.toHaveBeenCalled();
    expect(f.fallback).not.toHaveBeenCalled();
  });
  it("fails closed when disabled", async () => {
    const f = fixture(); f.d.enabled = false;
    await expect(f.dispatch()("codex_service_quote", quote)).rejects.toMatchObject({ code: "service_disabled" });
    expect(f.authenticate).not.toHaveBeenCalled(); expect(f.fallback).not.toHaveBeenCalled();
  });
  it("preserves unauthenticated catalog and legacy dispatch", async () => {
    const f = fixture();
    for (const name of ["codex_catalog_list", "codex_catalog_get_product", "codex_quote_request"]) {
      await expect(f.dispatch([])(name, {})).resolves.toEqual({ catalog: true });
    }
    expect(f.fallback).toHaveBeenCalledTimes(3); expect(f.authenticate).not.toHaveBeenCalled();
  });
  it("enforces scopes using the existing commerce boundary", async () => {
    const f = fixture();
    f.authenticate.mockResolvedValue({ buyerId: "buyer", clientId: "client", scopes: [] });
    await expect(f.dispatch()("codex_service_quote", quote)).rejects.toMatchObject({ code: "insufficient_scope" });
    expect(f.backend.quote).not.toHaveBeenCalled(); expect(f.fallback).not.toHaveBeenCalled();
  });
  it("isolates concurrent requests and snapshots header arrays", async () => {
    const f = fixture(), headers = ["Authorization", "Bearer buyer-A"];
    const a = f.dispatch(headers); headers[1] = "Bearer attacker";
    const b = f.dispatch(["authorization", "Bearer buyer-B"]);
    await expect(Promise.all([a("codex_service_quote", quote), b("codex_service_quote", quote)]))
      .resolves.toEqual([{ buyerId: "buyer-A" }, { buyerId: "buyer-B" }]);
  });
  it("does not accept identity from tool arguments", async () => {
    const f = fixture();
    await expect(f.dispatch()("codex_service_quote", { ...quote, bearer: "attacker" }))
      .rejects.toMatchObject({ code: "invalid_request" });
    expect(f.backend.quote).not.toHaveBeenCalled();
  });
  it.each(["codex_pricing_snapshot", "codex_pricing_compare", "codex_document_extract"])("routes %s with explicit per-call key", async name => {
    const f = fixture();
    const input = name === "codex_pricing_compare" ? { beforeId: "a", afterId: "b" } :
      name === "codex_document_extract" ? { documentId: "doc", profile: "scalar-fields-v1", fields: ["title"] } : quote.input;
    await f.dispatch()(name, { ...submit, input });
    expect(f.backend.submit).toHaveBeenCalledWith(expect.objectContaining({ buyerId: "buyer-A" }),
      expect.objectContaining({ input, quoteId: "quote-1", idempotencyKey: submit.idempotencyKey, digest: expect.any(String) }));
    expect(f.fallback).not.toHaveBeenCalled();
  });
  it("rejects missing and invalid submission keys", async () => {
    const f = fixture();
    for (const key of [undefined, "short", 42]) {
      const args = key === undefined ? { input: quote.input, quoteId: "q" } : { ...submit, idempotencyKey: key };
      await expect(f.dispatch()("codex_pricing_snapshot", args)).rejects.toBeInstanceOf(ApiError);
    }
    expect(f.backend.submit).not.toHaveBeenCalled();
  });
  it("forwards stable replay keys/digests and does not swallow backend conflicts", async () => {
    const f = fixture(), dispatch = f.dispatch();
    await dispatch("codex_pricing_snapshot", submit);
    await dispatch("codex_pricing_snapshot", submit);
    expect(f.backend.submit.mock.calls[0]).toEqual(f.backend.submit.mock.calls[1]);
    f.backend.submit.mockRejectedValueOnce(new ApiError(409, "idempotency_conflict"));
    await expect(dispatch("codex_pricing_snapshot", { ...submit, quoteId: "other" }))
      .rejects.toMatchObject({ code: "idempotency_conflict" });
    expect(f.fallback).not.toHaveBeenCalled();
  });
  it.each(["codex_job_get", "codex_result_get"])("routes buyer-scoped %s", async name => {
    const f = fixture();
    await expect(f.dispatch()(name, { id: "job-1" })).resolves.toEqual({ buyerId: "buyer-A" });
    expect(f.fallback).not.toHaveBeenCalled();
  });
  it("preserves rate limiting without gateway fallback", async () => {
    const f = fixture(); f.d.consume = async () => ({ allowed: false, retryAfter: 5 });
    await expect(f.dispatch()("codex_service_quote", quote)).rejects.toMatchObject({ code: "rate_limited" });
    expect(f.backend.quote).not.toHaveBeenCalled(); expect(f.fallback).not.toHaveBeenCalled();
  });
});
