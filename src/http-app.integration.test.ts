import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ApiError, type Dependencies, type Principal } from "./agent-commerce/api.js";
import { createHttpApp } from "./http-app.js";
import { loadTools } from "./load-tools.js";
import type { ToolDef } from "./server.js";
const PRICING_ROUTE = "/v1/pricing-extractions";

const names = ["codex_service_quote", "codex_pricing_snapshot", "codex_pricing_compare",
  "codex_document_extract", "codex_job_get", "codex_result_get"];
const fixtureTools: ToolDef[] = [...names, "codex_catalog_list", "codex_catalog_get_product", "legacy_test"]
  .map(name => ({ name, description: "HTTP fixture only; not published",
    inputSchema: { type: "object" } }));
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.closeAllConnections();
    server.close(error => error ? reject(error) : resolve());
  })));
});
function fixture(enabled = true) {
  const authenticate = vi.fn(async (token: string): Promise<Principal> => {
    if (token === "invalid") throw new ApiError(401, "unauthorized");
    return { buyerId: token, clientId: "client", scopes: token === "no-scope" ? [] :
      ["commerce:quote", "services:execute", "jobs:read", "results:read"] };
  });
  const quote = vi.fn(async (p: Principal) => ({ buyerId: p.buyerId }));
  const submit = vi.fn(async (_p: Principal, v: Parameters<Dependencies["backend"]["submit"]>[1]) => ({ id: v.idempotencyKey }));
  const read = async (p: Principal, id: string) => id === "missing" ? null : { buyerId: p.buyerId, id };
  const commerce: Dependencies = { enabled, authenticate,
    consume: vi.fn(async () => ({ allowed: true, retryAfter: 0 })),
    backend: { quote, submit, job: read, result: read } };
  const dispatch = vi.fn(async (name: string) => ({ legacy: name }));
  return { commerce, authenticate, quote, submit, dispatch };
}
async function start(f = fixture(), tools = fixtureTools) {
  const storefront = express.Router();
  storefront.post("/fixture-storefront", express.json({ limit: "1kb" }), (req, res) => res.json(req.body));
  const app = createHttpApp({ tools, commerce: f.commerce, dispatch: f.dispatch,
    catalog: { catalog_version: "fixture", offers: [] }, agentCardJson: '{"name":"fixture"}',
    storefrontRouter: storefront, pricingRoute: PRICING_ROUTE });
  const server = app.listen(0, "127.0.0.1"); servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve); server.once("error", reject);
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { ...f, url };
}
function http(url: string, path: string, body?: string, extraHeaders: string[] = []) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request(new URL(path, url), {
      method: body === undefined ? "GET" : "POST",
      headers: ["Host", new URL(url).host, "Accept", "application/json, text/event-stream", "Connection", "close",
        ...(body === undefined ? [] : ["Content-Type", "application/json",
          "Content-Length", String(Buffer.byteLength(body))]), ...extraHeaders],
    }, res => {
      let text = ""; res.setEncoding("utf8");
      res.on("data", chunk => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text }));
      res.on("error", reject);
    });
    req.setTimeout(5000, () => req.destroy(new Error("fixture_http_timeout")));
    req.on("error", reject); req.end(body);
  });
}
function rpcBody(body: string) {
  // The production transport keeps its default SSE response mode.
  const data = body.split(/\r?\n/).filter(line => line.startsWith("data: ")).map(line => line.slice(6));
  return JSON.parse(data.length ? data[data.length - 1] : body);
}
async function call(url: string, name: string, args: Record<string, unknown> = {}, headers = ["Authorization", "Bearer buyer-A"]) {
  const response = await http(url, "/mcp", JSON.stringify({ jsonrpc: "2.0", id: 1,
    method: "tools/call", params: { name, arguments: args } }), headers);
  expect(response.status).toBe(200);
  return rpcBody(response.body);
}
function toolValue(reply: { result: { content: Array<{ text: string }> } }) {
  return JSON.parse(reply.result.content[0].text);
}
const quoteArgs = { service: "pricing_snapshot", input: { sourceId: "source" } };

describe("HTTP MCP transport and injected app", () => {
  it("initializes, lists and calls public catalog using the real SDK HTTP client", async () => {
    const f = await start();
    const client = new Client({ name: "http-fixture", version: "1.0.0" });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL("/mcp", f.url)));
      expect((await client.listTools()).tools.map(t => t.name)).toContain("codex_catalog_list");
      const result = await client.callTool({ name: "codex_catalog_list", arguments: {} });
      expect(result.isError).not.toBe(true);
      expect(f.authenticate).not.toHaveBeenCalled();
      expect(f.dispatch).toHaveBeenCalledWith("codex_catalog_list", {});
    } finally { await client.close(); }
  });
  it.each([
    { label: "missing", headers: [] },
    { label: "malformed", headers: ["Authorization", "Basic invalid"] },
    { label: "invalid", headers: ["Authorization", "Bearer invalid"] },
    { label: "duplicate", headers: ["Authorization", "Bearer buyer-A", "Authorization", "Bearer buyer-B"] },
    { label: "oversized", headers: ["Authorization", "Bearer " + "x".repeat(8193)] },
  ])("rejects $label credentials over HTTP without gateway fallback", async ({ headers }) => {
    const f = await start();
    const reply = await call(f.url, "codex_service_quote", quoteArgs, headers);
    expect(reply.result.isError).toBe(true);
    expect(toolValue(reply)).toEqual({ error: { code: "unauthorized", retryable: false } });
    expect(f.quote).not.toHaveBeenCalled(); expect(f.dispatch).not.toHaveBeenCalled();
  });
  it("fails closed while disabled and preserves the public catalog", async () => {
    const f = await start(fixture(false));
    expect(toolValue(await call(f.url, "codex_service_quote", quoteArgs))).toEqual({ error: { code: "service_disabled", retryable: true } });
    expect(f.authenticate).not.toHaveBeenCalled(); expect(f.dispatch).not.toHaveBeenCalled();
    await call(f.url, "codex_catalog_list", {}, []);
    expect(f.dispatch).toHaveBeenCalledTimes(1);
  });
  it("enforces scopes", async () => {
    const f = await start();
    expect(toolValue(await call(f.url, "codex_service_quote", quoteArgs, ["Authorization", "Bearer no-scope"])))
      .toEqual({ error: { code: "insufficient_scope", retryable: false } });
    expect(f.quote).not.toHaveBeenCalled(); expect(f.dispatch).not.toHaveBeenCalled();
  });
  it("isolates concurrent HTTP buyers", async () => {
    const f = await start();
    const replies = await Promise.all(["buyer-A", "buyer-B"].map(buyer =>
      call(f.url, "codex_service_quote", quoteArgs, ["Authorization", `Bearer ${buyer}`])));
    expect(replies.map(toolValue)).toEqual([{ buyerId: "buyer-A" }, { buyerId: "buyer-B" }]);
  });
  it("forwards stable replay keys, distinct per-call keys and conflicts", async () => {
    const f = await start();
    const args = { input: { sourceId: "source" }, quoteId: "quote", idempotencyKey: "request_00000001" };
    await call(f.url, "codex_pricing_snapshot", args);
    await call(f.url, "codex_pricing_snapshot", args);
    expect(f.submit.mock.calls[0]).toEqual(f.submit.mock.calls[1]);
    await call(f.url, "codex_pricing_snapshot", { ...args, idempotencyKey: "request_00000002" });
    expect(f.submit.mock.calls[2][1].idempotencyKey).toBe("request_00000002");
    f.submit.mockRejectedValueOnce(new ApiError(409, "idempotency_conflict"));
    expect(toolValue(await call(f.url, "codex_pricing_snapshot", { ...args, quoteId: "different" })))
      .toEqual({ error: { code: "idempotency_conflict", retryable: false } });
    expect(f.dispatch).not.toHaveBeenCalled();
  });
  it("redacts internal failures", async () => {
    const f = await start(); f.quote.mockRejectedValueOnce(new Error("secret-provider-token"));
    const reply = await call(f.url, "codex_service_quote", quoteArgs);
    expect(toolValue(reply)).toEqual({ error: { code: "tool_execution_failed", retryable: false } });
    expect(JSON.stringify(reply)).not.toContain("secret-provider-token");
  });
  it("keeps production commerce tools unpublished", async () => {
    const tools = loadTools();
    for (const name of names) expect(tools.some(t => t.name === name)).toBe(false);
    const f = await start(fixture(), tools);
    const reply = await call(f.url, "codex_pricing_snapshot", {});
    expect(reply.error.message).toBe("unknown_tool");
    expect(f.authenticate).not.toHaveBeenCalled(); expect(f.dispatch).not.toHaveBeenCalled();
  });
  it("preserves storefront parsing, agent API parsing and disabled pricing", async () => {
    const f = await start();
    expect(JSON.parse((await http(f.url, "/fixture-storefront", '{"ownedParser":true}')).body)).toEqual({ ownedParser: true });
    const agent = await http(f.url, "/api/v1/agent/quotes", JSON.stringify(quoteArgs), ["Authorization", "Bearer buyer-A"]);
    expect(agent.status).toBe(200); expect(JSON.parse(agent.body).data.buyerId).toBe("buyer-A");
    const pricing = await http(f.url, PRICING_ROUTE, "{}");
    expect(pricing.status).toBe(503); expect(JSON.parse(pricing.body).error).toBe("x402_disabled");
    expect((await http(f.url, "/healthz")).status).toBe(200);
    expect(JSON.parse((await http(f.url, "/api/v1/catalog.json")).body).catalog_version).toBe("fixture");
    expect(JSON.parse((await http(f.url, "/.well-known/agent-card.json")).body).name).toBe("fixture");
  });
  it("rejects malformed MCP JSON without exposing parser details", async () => {
    const f = await start();
    const response = await http(f.url, "/mcp", '{"private-marker":');
    expect(response.status).toBe(400);
    expect(JSON.parse(response.body).error).toBe("invalid_request");
    expect(response.body).not.toContain("private-marker");
  });
  it("preserves the pricing body limit and mounts injected pricing middleware last", async () => {
    const f = fixture();
    const pricing = vi.fn((_req: express.Request, res: express.Response) => { res.json({ fixturePricing: true }); });
    const app = createHttpApp({ tools: fixtureTools, commerce: f.commerce, dispatch: f.dispatch,
      catalog: { catalog_version: "fixture", offers: [] }, agentCardJson: "{}",
      storefrontRouter: (_req, _res, next) => next(), pricingRoute: PRICING_ROUTE, pricingRouter: pricing });
    const server = app.listen(0, "127.0.0.1"); servers.push(server);
    await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await call(url, "codex_catalog_list", {}, []);
    expect(pricing).not.toHaveBeenCalled();
    const large = await http(url, PRICING_ROUTE, JSON.stringify({ value: "x".repeat(9000) }));
    expect(large.status).toBe(413); expect(pricing).not.toHaveBeenCalled();
    expect(JSON.parse((await http(url, PRICING_ROUTE, "{}")).body)).toEqual({ fixturePricing: true });
  });

});
