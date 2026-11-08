import express from "express";
import type { Server } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { APPROVED_BACKEND_ORIGIN, createWebToJsonRouter } from "./web-to-json-router.js";

const KEY = `Bearer w2j_${"a".repeat(48)}`;
const clientFetch = globalThis.fetch;
const servers: Server[] = [];
const input = { url: "https://example.com/pricing", idempotency_key: "buyer-request-001" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
async function fixture(reply: typeof fetch = async () => json({ balance: 50 }), origin = APPROVED_BACKEND_ORIGIN) {
  const upstream = vi.fn(reply);
  const app = express();
  app.use(createWebToJsonRouter({ backendOrigin: origin, fetchImpl: upstream }));
  const server = app.listen(0, "127.0.0.1");
  servers.push(server); await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/web-to-json`;
  const call = (path: string, body: unknown = {}, auth: string | null = KEY) => clientFetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify(body) });
  return { upstream, base, call };
}
afterEach(async () => {
  vi.useRealTimers();
  for (const server of servers.splice(0)) await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); });
});

describe("prepaid Render delivery with mocked upstream", () => {
  it.each(["", "https://evil.example", APPROVED_BACKEND_ORIGIN + "/", APPROVED_BACKEND_ORIGIN + ".evil.example"])("fails closed for origin %s", async origin => {
    const f = await fixture(undefined, origin); expect((await f.call("/balance")).status).toBe(503); expect(f.upstream).not.toHaveBeenCalled();
  });
  it("requires buyer bearer auth", async () => {
    const f = await fixture(); expect((await f.call("/balance", {}, null)).status).toBe(401); expect((await f.call("/balance", {}, "Bearer merchant-secret")).status).toBe(401); expect(f.upstream).not.toHaveBeenCalled();
  });
  it("forwards fixed extraction path, credential and idempotent input", async () => {
    const result = { job_id: "job-1", status: "completed", balance: 49, charged_units: 1, result: { plans: [{ name: "Basic", price: 10, evidence: "Basic $10" }] } };
    const f = await fixture(async () => json(result)); const response = await f.call("/extractions", input);
    expect(response.status).toBe(200); expect(await response.json()).toEqual(result); expect(response.headers.get("cache-control")).toBe("no-store"); expect(response.headers.get("x-request-id")).toBeTruthy();
    const [url, init] = f.upstream.mock.calls[0];
    expect(String(url)).toBe(APPROVED_BACKEND_ORIGIN + "/functions/web_to_json_extract"); expect(init?.redirect).toBe("error"); expect(init?.method).toBe("POST"); expect(init?.headers).toEqual({ accept: "application/json", "content-type": "application/json", authorization: KEY }); expect(JSON.parse(init?.body as string)).toEqual(input); expect(f.upstream).toHaveBeenCalledTimes(1);
  });
  it.each([{ url: input.url }, { ...input, units: 50 }, { ...input, api_key: "secret" }, { ...input, url: "http://example.com" }, { ...input, url: "https://user:pass@example.com" }])("rejects invalid extraction input %j", async body => {
    const f = await fixture(); expect((await f.call("/extractions", body)).status).toBe(400); expect(f.upstream).not.toHaveBeenCalled();
  });
  it("maps job lookup and ignores unapproved forwarding headers", async () => {
    const f = await fixture(); const response = await clientFetch(f.base + "/jobs/job-123?origin=https://evil.example", { headers: { authorization: KEY, "x-base44-app-url": "https://evil.example" } });
    expect(response.status).toBe(200); const [url, init] = f.upstream.mock.calls[0]; expect(String(url)).toBe(APPROVED_BACKEND_ORIGIN + "/functions/web_to_json_job"); expect(JSON.parse(init?.body as string)).toEqual({ id: "job-123" }); expect(init?.headers).not.toHaveProperty("x-base44-app-url");
  });
  it("exchanges a delivery token without forwarding bearer auth", async () => {
    const f = await fixture(async () => json({ api_key: "mock-only", balance: 50 }, 201)); expect((await f.call("/access", { token: "a".repeat(32) }, null)).status).toBe(201); expect(f.upstream.mock.calls[0][1]?.headers).not.toHaveProperty("authorization");
  });
  it.each([401, 402, 404, 409, 429])("preserves upstream status %s", async status => {
    const f = await fixture(async () => json({ error: "fixture" }, status)); const response = await f.call("/balance"); expect(response.status).toBe(status); expect(await response.json()).toEqual({ error: "fixture" });
  });
  it("does not retry ambiguous failures", async () => {
    const f = await fixture(async () => { throw new Error("private internals"); }); const response = await f.call("/extractions", input); expect(response.status).toBe(502); expect(await response.text()).not.toContain("private internals"); expect(f.upstream).toHaveBeenCalledTimes(1);
  });
  it.each([
    () => json({ error: "private internals" }, 500),
    () => new Response("<html>", { headers: { "content-type": "text/html" } }),
    () => new Response("{broken", { headers: { "content-type": "application/json" } }),
    () => json([1, 2]),
    () => new Response(null, { status: 302, headers: { location: "https://evil.example" } }),
  ])("rejects invalid backend response", async reply => {
    const f = await fixture(async () => reply()); const response = await f.call("/balance"); expect(response.status).toBe(502); expect(await response.text()).not.toContain("private internals");
  });
  it("caps streaming bytes and cancels oversized responses", async () => {
    const cancel = vi.fn(); let chunks = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { chunks++; controller.enqueue(new Uint8Array(600_000)); }, cancel });
    const f = await fixture(async () => new Response(stream, { headers: { "content-type": "application/json" } })); expect((await f.call("/balance")).status).toBe(502); expect(cancel).toHaveBeenCalledTimes(1); expect(chunks).toBeLessThanOrEqual(3);
  });
  it("rejects non-JSON, malformed JSON and oversized requests", async () => {
    const f = await fixture(); expect((await clientFetch(f.base + "/balance", { method: "POST", body: "{}" })).status).toBe(415);
    expect((await clientFetch(f.base + "/balance", { method: "POST", headers: { "content-type": "application/json" }, body: "{broken" })).status).toBe(400);
    expect((await f.call("/access", { token: "a".repeat(9000) }, null)).status).toBe(413); expect(f.upstream).not.toHaveBeenCalled();
  });
});
