import { describe, expect, it } from "vitest";
import { ApiError } from "../agent-commerce/api.js";
import { isPublicAddress, parseIPv6Bytes, SafeFetchAdapter, SafeFetchError, validateFetchUrl, type FetchResponse } from "./safe-fetch.js";

type Disposal = { disposed: boolean };
type DisposableStream = AsyncIterable<Uint8Array> & { destroy(error?: Error): void };

const publicRecords = [{ address: "93.184.216.34", family: 4 }];
const signal = () => new AbortController().signal;

function fakeStream(chunks: string[], disposal?: Disposal): DisposableStream {
  const encoder = new TextEncoder();
  return {
    destroy() { if (disposal) disposal.disposed = true; },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield encoder.encode(chunk);
    },
  };
}

function response(status: number, headers: Record<string, string> = {}, chunks: string[] = ["ok"], disposal?: Disposal): FetchResponse {
  return { status, headers, stream: fakeStream(chunks, disposal) };
}

describe("destination policy", () => {
  it("classifies IPv4 ranges", () => {
    expect(isPublicAddress("8.8.8.8")).toBe(true);
    expect(isPublicAddress("93.184.216.34")).toBe(true);
    expect(isPublicAddress("172.32.0.1")).toBe(true);
    for (const ip of ["10.0.0.1", "127.0.0.1", "0.0.0.0", "192.168.1.1", "172.16.0.1", "172.31.255.255",
      "169.254.169.254", "100.64.0.1", "192.0.0.8", "192.0.2.1", "198.18.0.1", "198.51.100.7",
      "203.0.113.9", "224.0.0.1", "255.255.255.255"]) {
      expect(isPublicAddress(ip)).toBe(false);
    }
  });

  it("normalizes IPv6 and closes mapped-address bypasses", () => {
    for (const ip of ["2606:4700::1111", "2a00:1450:4001:81b::200e", "2606:4700::1111".toUpperCase(),
      "::ffff:8.8.8.8", "0:0:0:0:0:ffff:8.8.8.8", "64:ff9b::8.8.8.8", "2002:0808:0808::"]) {
      expect(isPublicAddress(ip)).toBe(true);
    }
    for (const ip of ["::", "::1", "fe80::1", "fe80::1%eth0", "febf::1", "fec0::1", "fc00::1", "fd00::1",
      "ff02::1", "2001:db8::1", "2001:0:0:1::1", "100::", "::ffff:127.0.0.1", "0:0:0:0:0:ffff:127.0.0.1",
      "0:0:0:0:0:ffff:7f00:1", "::7f00:1", "::127.0.0.1", "64:ff9b::127.0.0.1", "64:ff9b::0.0.0.0",
      "::ffff:10.0.0.1", "2002:7f00:1::"]) {
      expect(isPublicAddress(ip)).toBe(false);
    }
  });

  it("fails closed on malformed addresses", () => {
    for (const ip of ["", "not-an-ip", "999.1.1.1", "1.2.3", "1:2:3", ":::", "1::2::3", "12345::",
      "gg::1", "1.2.3.4.5", "::ffff:999.1.1.1", "1:2:3:4:5:6:7:8:9", "1:2:3:4:5:6:7:8:"]) {
      expect(isPublicAddress(ip)).toBe(false);
    }
  });

  it("expands IPv6 notation to exact bytes", () => {
    expect(parseIPv6Bytes("::")).toEqual(new Array(16).fill(0));
    expect(parseIPv6Bytes("::1")).toEqual([...new Array(15).fill(0), 1]);
    expect(parseIPv6Bytes("::ffff:1.2.3.4")).toEqual([...new Array(10).fill(0), 255, 255, 1, 2, 3, 4]);
    expect(parseIPv6Bytes("1:2:3:4:5:6:7:8")).toEqual([0, 1, 0, 2, 0, 3, 0, 4, 0, 5, 0, 6, 0, 7, 0, 8]);
    expect(parseIPv6Bytes("2606:4700::1111")).toEqual([0x26, 0x06, 0x47, 0, ...new Array(10).fill(0), 0x11, 0x11]);
    expect(parseIPv6Bytes("fe80::1%eth0")).toEqual([0xfe, 0x80, ...new Array(12).fill(0), 0, 1]);
    expect(parseIPv6Bytes("64:ff9b::8.8.8.8")).toEqual([0, 0x64, 0xff, 0x9b, ...new Array(8).fill(0), 8, 8, 8, 8]);
    expect(parseIPv6Bytes("2002:0808:0808::")).toEqual([0x20, 0x02, 8, 8, 8, 8, ...new Array(10).fill(0)]);
    expect(parseIPv6Bytes("1:2:3")).toBeNull();
    expect(parseIPv6Bytes(":::")).toBeNull();
    expect(parseIPv6Bytes("1::2::3")).toBeNull();
  });
});

describe("url validation", () => {
  it("accepts only https urls without credentials or fragments", () => {
    const url = validateFetchUrl("https://example.test/data?x=1");
    expect(url.hostname).toBe("example.test");
    expect(validateFetchUrl("https://example.test:8443/x").port).toBe("8443");
    for (const bad of ["http://example.test/", "ftp://example.test/", "https://u:p@example.test/",
      "https://example.test/#fragment", "", "not a url", "https://example.test:0/"]) {
      expect(() => validateFetchUrl(bad)).toThrow(SafeFetchError);
    }
    expect(() => validateFetchUrl("https://" + "a".repeat(2048) + ".test/")).toThrow(SafeFetchError);
  });
});

describe("SafeFetchAdapter", () => {
  it("pins the validated address and reads the body", async () => {
    const seen: string[] = [];
    const adapter = new SafeFetchAdapter({ deps: {
      resolve: async hostname => { seen.push(hostname); return publicRecords; },
      connect: async target => { seen.push(target.ip); return response(200, { "content-type": "application/json" }, ["{\"a\":", "1}"]); },
    } });
    const result = await adapter.fetch("https://example.test/data", signal());
    expect(result.body).toBe("{\"a\":1}");
    expect(result.contentType).toBe("application/json");
    expect(seen).toEqual(["example.test", "93.184.216.34"]);
  });

  it("rejects private or mixed dns results before connecting", async () => {
    const cases = [
      [{ address: "10.0.0.5", family: 4 }],
      [{ address: "fd00::1", family: 6 }],
      [{ address: "93.184.216.34", family: 4 }, { address: "0:0:0:0:0:ffff:127.0.0.1", family: 6 }],
    ];
    for (const records of cases) {
      let connected = false;
      const adapter = new SafeFetchAdapter({ deps: {
        resolve: async () => records,
        connect: async () => { connected = true; return response(200); },
      } });
      await expect(adapter.fetch("https://example.test/", signal())).rejects.toThrow("fetch_private_address_rejected");
      expect(connected).toBe(false);
    }
  });

  it("treats dns failures and oversized dns answers as transient", async () => {
    const failing = new SafeFetchAdapter({ deps: {
      resolve: async () => { throw new Error("resolver offline"); },
      connect: async () => response(200),
    } });
    await expect(failing.fetch("https://example.test/", signal())).rejects.toThrow("fetch_dns_failed");
    const flooded = Array.from({ length: 33 }, () => ({ address: "93.184.216.34", family: 4 }));
    const adapter = new SafeFetchAdapter({ deps: {
      resolve: async () => flooded,
      connect: async () => response(200),
    } });
    await expect(adapter.fetch("https://example.test/", signal())).rejects.toThrow("fetch_dns_failed");
  });

  it("validates bracketed literals without dns", async () => {
    const calls: string[] = [];
    const adapter = new SafeFetchAdapter({ deps: {
      resolve: async hostname => { calls.push("dns:" + hostname); return publicRecords; },
      connect: async target => { calls.push(target.ip); return response(200); },
    } });
    const result = await adapter.fetch("https://[2606:4700::1111]/", signal());
    expect(result.body).toBe("ok");
    expect(calls).toEqual(["2606:4700::1111"]);
    const blocked = new SafeFetchAdapter({ deps: {
      resolve: async () => publicRecords,
      connect: async () => response(200),
    } });
    await expect(blocked.fetch("https://[::1]/", signal())).rejects.toThrow("fetch_private_address_rejected");
  });

  it("re-validates every redirect and disposes redirect bodies", async () => {
    const disposal: Disposal = { disposed: false };
    const urls: string[] = [];
    const adapter = new SafeFetchAdapter({ maxRedirects: 1, deps: {
      resolve: async () => publicRecords,
      connect: async target => {
        urls.push(target.url.hostname + target.url.pathname);
        if (urls.length === 1) return response(301, { location: "https://other.test/final" }, ["ignored"], disposal);
        return response(200, {}, ["done"]);
      },
    } });
    const result = await adapter.fetch("https://example.test/start", signal());
    expect(result.body).toBe("done");
    expect(urls).toEqual(["example.test/start", "other.test/final"]);
    expect(disposal.disposed).toBe(true);
  });

  it("bounds redirects, rejects downgrades and re-validates redirect targets", async () => {
    const looped = new SafeFetchAdapter({ maxRedirects: 0, deps: {
      resolve: async () => publicRecords,
      connect: async () => response(302, { location: "https://example.test/again" }, ["ignored"], { disposed: false }),
    } });
    await expect(looped.fetch("https://example.test/", signal())).rejects.toThrow("fetch_too_many_redirects");
    const downgrade = new SafeFetchAdapter({ deps: {
      resolve: async () => publicRecords,
      connect: async () => response(301, { location: "http://other.test/x" }, ["ignored"], { disposed: false }),
    } });
    await expect(downgrade.fetch("https://example.test/", signal())).rejects.toThrow(SafeFetchError);
    const internal = new SafeFetchAdapter({ deps: {
      resolve: async hostname => hostname === "internal.test" ? [{ address: "10.0.0.9", family: 4 }] : publicRecords,
      connect: async () => response(301, { location: "https://internal.test/x" }, ["ignored"], { disposed: false }),
    } });
    await expect(internal.fetch("https://example.test/", signal())).rejects.toThrow("fetch_private_address_rejected");
  });

  it("classifies terminal and transient statuses", async () => {
    const notFound = new SafeFetchAdapter({ deps: { resolve: async () => publicRecords, connect: async () => response(404) } });
    await expect(notFound.fetch("https://example.test/", signal())).rejects.toThrow(ApiError);
    const upstream = new SafeFetchAdapter({ deps: { resolve: async () => publicRecords, connect: async () => response(503) } });
    await expect(upstream.fetch("https://example.test/", signal())).rejects.toThrow("fetch_upstream_unavailable");
  });

  it("enforces the byte cap and disposes the stream", async () => {
    const disposal: Disposal = { disposed: false };
    const heavy = new SafeFetchAdapter({ maxBytes: 4, deps: {
      resolve: async () => publicRecords,
      connect: async () => response(200, {}, ["12345", "678"], disposal),
    } });
    await expect(heavy.fetch("https://example.test/", signal())).rejects.toThrow("source_too_large");
    expect(disposal.disposed).toBe(true);
  });

  it("honors caller cancellation and the time bound", async () => {
    const cancelled = new AbortController();
    cancelled.abort();
    const immediate = new SafeFetchAdapter({ deps: { resolve: async () => publicRecords, connect: async () => response(200) } });
    await expect(immediate.fetch("https://example.test/", cancelled.signal)).rejects.toThrow("fetch_aborted");
    const slow = new SafeFetchAdapter({ timeoutMs: 250, deps: {
      resolve: async () => publicRecords,
      connect: () => new Promise<FetchResponse>(() => {}),
    } });
    await expect(slow.fetch("https://example.test/", signal())).rejects.toThrow("fetch_timeout");
  });

  it("disposes the stream when the caller aborts mid-read", async () => {
    const disposal: Disposal = { disposed: false };
    const caller = new AbortController();
    const adapter = new SafeFetchAdapter({ deps: {
      resolve: async () => publicRecords,
      connect: async () => {
        const stream: DisposableStream = {
          destroy() { disposal.disposed = true; },
          async *[Symbol.asyncIterator]() {
            yield new TextEncoder().encode("par");
            await new Promise(resolve => setTimeout(resolve, 50));
            if (caller.signal.aborted) throw new SafeFetchError("fetch_aborted");
            yield new TextEncoder().encode("tial");
          },
        };
        return { status: 200, headers: {}, stream };
      },
    } });
    const pending = adapter.fetch("https://example.test/", caller.signal);
    setTimeout(() => caller.abort(), 10);
    await expect(pending).rejects.toThrow();
    expect(disposal.disposed).toBe(true);
  });

  it("rejects invalid construction", () => {
    expect(() => new SafeFetchAdapter({ maxBytes: 0 })).toThrow("invalid_fetch_configuration");
    expect(() => new SafeFetchAdapter({ timeoutMs: 10 })).toThrow("invalid_fetch_configuration");
    expect(() => new SafeFetchAdapter({ maxRedirects: 6 })).toThrow("invalid_fetch_configuration");
    expect(() => new SafeFetchAdapter({ dnsTimeoutMs: 100 })).toThrow("invalid_fetch_configuration");
    expect(() => new SafeFetchAdapter({ maxDnsRecords: 0 })).toThrow("invalid_fetch_configuration");
  });
});
