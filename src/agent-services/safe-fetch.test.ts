import { describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import { ApiError } from "../agent-commerce/api.js";
import { isPublicAddress, SafeFetchAdapter, validateFetchUrl,
  type FetchResponse, type ResolvedTarget, type SafeFetchDeps } from "./safe-fetch.js";
import { SnapshotProvider } from "./snapshot-provider.js";

const PUBLIC_IP = "93.184.216.34";
function response(status: number, body: string, headers: Record<string, string> = {}): FetchResponse {
  return { status, headers,
    stream: Readable.from([Buffer.from(body, "utf8")]) };
}
function adapter(over: {
  maxBytes?: number; timeoutMs?: number; maxRedirects?: number; deps?: Partial<SafeFetchDeps>;
} = {}) {
  return new SafeFetchAdapter({
    maxBytes: over.maxBytes, timeoutMs: over.timeoutMs, maxRedirects: over.maxRedirects,
    deps: over.deps,
  });
}
const resolvePublic = async () => [{ address: PUBLIC_IP, family: 4 }];
const signal = () => new AbortController().signal;

describe("safe fetch adapter", () => {
  it("validates fetch URLs strictly", () => {
    expect(validateFetchUrl("https://example.test/pricing").pathname).toBe("/pricing");
    for (const bad of ["http://example.test/", "https://user:pw@example.test/",
      "https://example.test/#frag", "not a url", ""]) {
      expect(() => validateFetchUrl(bad)).toThrow("invalid_fetch_url");
    }
  });
  it("rejects non-public addresses in both families", () => {
    for (const blocked of ["127.0.0.1", "10.1.2.3", "192.168.0.1", "172.31.255.1",
      "169.254.169.254", "0.0.0.0", "100.64.0.1", "224.0.0.1", "255.255.255.255",
      "::1", "fe80::1", "fd12::1", "ff02::1", "::ffff:10.0.0.1", "2001:db8::1"]) {
      expect(isPublicAddress(blocked), blocked).toBe(false);
    }
    expect(isPublicAddress(PUBLIC_IP)).toBe(true);
    expect(isPublicAddress("2606:2800:220:1:248:1893:25c8:1946")).toBe(true);
  });
  it("rejects configuration outside safe ranges", () => {
    expect(() => new SafeFetchAdapter({ maxRedirects: 9 })).toThrow("invalid_fetch_configuration");
    expect(() => new SafeFetchAdapter({ timeoutMs: 10 })).toThrow("invalid_fetch_configuration");
    expect(() => new SafeFetchAdapter({ maxBytes: 0 })).toThrow("invalid_fetch_configuration");
  });
  it("refuses to connect when resolution yields a private address", async () => {
    const connect = async () => { throw new Error("must_not_connect"); };
    const fetcher = adapter({ deps: { resolve: async () => [{ address: "10.0.0.5", family: 4 }], connect } });
    await expect(fetcher.fetch("https://private.test/pricing", signal()))
      .rejects.toThrow("fetch_private_address_rejected");
  });
  it("refuses mixed public/private resolutions", async () => {
    const fetcher = adapter({ deps: { resolve: async () =>
      [{ address: PUBLIC_IP, family: 4 }, { address: "127.0.0.1", family: 4 } ] } });
    await expect(fetcher.fetch("https://mixed.test/", signal()))
      .rejects.toThrow("fetch_private_address_rejected");
  });
  it("fetches a validated public target and pins the connection IP", async () => {
    const targets: ResolvedTarget[] = [];
    const fetcher = adapter({ deps: { resolve: resolvePublic, connect: async target => {
      targets.push(target);
      return response(200, '{"offers":[]}', { "content-type": "application/json" });
    } } });
    const result = await fetcher.fetch("https://example.test/pricing?x=1", signal());
    expect(result).toEqual({ body: '{"offers":[]}', contentType: "application/json" });
    expect(targets[0]).toMatchObject({ ip: PUBLIC_IP });
    expect(targets[0].url.pathname).toBe("/pricing");
  });
  it("follows bounded redirects with full re-validation", async () => {
    const paths: string[] = [];
    const fetcher = adapter({ deps: { resolve: resolvePublic, connect: async target => {
      paths.push(target.url.pathname);
      if (target.url.pathname === "/first") return response(302, "", { location: "https://example.test/second" });
      return response(200, "ok");
    } } });
    const result = await fetcher.fetch("https://example.test/first", signal());
    expect(result.body).toBe("ok");
    expect(paths).toEqual(["/first", "/second"]);
  });
  it("rejects redirects to non-HTTPS schemes", async () => {
    const fetcher = adapter({ deps: { resolve: resolvePublic, connect: async () =>
      response(302, "", { location: "http://example.test/plain" }) } });
    await expect(fetcher.fetch("https://example.test/", signal()))
      .rejects.toThrow("invalid_fetch_url");
  });
  it("rejects redirect loops beyond the configured bound", async () => {
    const fetcher = adapter({ maxRedirects: 0, deps: { resolve: resolvePublic,
      connect: async () => response(302, "", { location: "https://example.test/loop" }) } });
    await expect(fetcher.fetch("https://example.test/", signal()))
      .rejects.toThrow("fetch_too_many_redirects");
  });
  it("treats 4xx source responses as terminal provider rejections", async () => {
    const fetcher = adapter({ deps: { resolve: resolvePublic, connect: async () => response(404, "") } });
    await expect(fetcher.fetch("https://example.test/gone", signal()))
      .rejects.toMatchObject({ status: 422, code: "invalid_source_status" });
  });
  it("treats upstream 5xx as transient, not a terminal rejection", async () => {
    const fetcher = adapter({ deps: { resolve: resolvePublic, connect: async () => response(503, "") } });
    await expect(fetcher.fetch("https://example.test/down", signal()))
      .rejects.toThrow("fetch_upstream_unavailable");
  });
  it("enforces the byte limit while streaming", async () => {
    const fetcher = adapter({ maxBytes: 8, deps: { resolve: resolvePublic,
      connect: async () => response(200, "x".repeat(64)) } });
    await expect(fetcher.fetch("https://example.test/big", signal()))
      .rejects.toMatchObject({ status: 422, code: "source_too_large" });
  });
  it("applies its own timeout to stalled connections", async () => {
    const fetcher = adapter({ timeoutMs: 300, deps: { resolve: resolvePublic,
      connect: (_target, s) => new Promise<FetchResponse>((_resolve, reject) => {
        s.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      }) } });
    await expect(fetcher.fetch("https://example.test/slow", signal()))
      .rejects.toThrow("fetch_timeout");
  }, 5000);
  it("rejects an already-cancelled caller", async () => {
    const fetcher = adapter({ deps: { resolve: resolvePublic, connect: async () => response(200, "x") } });
    const controller = new AbortController(); controller.abort();
    await expect(fetcher.fetch("https://example.test/x", controller.signal))
      .rejects.toThrow("fetch_aborted");
  });
  it("composes with the snapshot provider as its fetch boundary", async () => {
    const fetcher = adapter({ deps: { resolve: resolvePublic, connect: async () => response(200,
      JSON.stringify({ offers: [{ name: "Pro", amount: 10, currency: "USD", interval: "month" }] }),
      { "content-type": "application/json" }) } });
    const persisted: unknown[] = [];
    const provider = new SnapshotProvider(
      { findOwnedSource: async (buyerId, sourceId) => buyerId === "buyer-1" && sourceId === "src-1"
          ? { buyerId, sourceId, url: "https://example.test/pricing", approvedForCapture: true } : null },
      fetcher,
      { persist: async snapshot => { persisted.push(snapshot); } },
      () => new Date("2026-11-13T17:00:00.000Z"));
    const value = await provider.capture(
      { buyerId: "buyer-1", clientId: "client", scopes: ["services:execute"] }, "src-1",
      { jobId: "job-safe", attempt: 1, signal: signal() });
    expect(value).toMatchObject({ id: "snap-job-safe", coverage: "complete" });
    expect(persisted).toHaveLength(1);
  });
});
