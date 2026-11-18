import { describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
import { isPublicAddress, SafeFetchAdapter, type FetchResponse } from "./safe-fetch.js";

const signal = () => new AbortController().signal;
const blocked = ["192.168.0.0", "192.168.0.1", "192.168.255.255"];
describe("192.168/16 regression", () => {
  it.each(blocked)("rejects %s", address => {
    expect(isPublicAddress(address)).toBe(false);
  });
  it.each(["192.167.255.255", "192.169.0.0"])("does not extend this block to adjacent address %s", address => {
    expect(isPublicAddress(address)).toBe(true);
  });
  it("rejects the existing dotted IPv4-mapped representation", () => {
    expect(isPublicAddress("::ffff:192.168.0.1")).toBe(false);
  });
  it("never connects for any of the range-boundary DNS results", async () => {
    for (const address of blocked) {
      const connect = vi.fn(async (): Promise<FetchResponse> => { throw new Error("unexpected_connect"); });
      const fetcher = new SafeFetchAdapter({ deps: {
        resolve: async () => [{ address, family: 4 }], connect,
      } });
      await expect(fetcher.fetch("https://example.test/pricing", signal())).rejects.toThrow("fetch_private_address_rejected");
      expect(connect).not.toHaveBeenCalled();
    }
  });
  it("rejects a mixed public and 192.168 answer before connecting", async () => {
    const connect = vi.fn(async (): Promise<FetchResponse> => { throw new Error("unexpected_connect"); });
    const fetcher = new SafeFetchAdapter({ deps: { resolve: async () => [
      { address: "93.184.216.34", family: 4 }, { address: "192.168.0.1", family: 4 },
    ], connect } });
    await expect(fetcher.fetch("https://example.test/pricing", signal())).rejects.toThrow("fetch_private_address_rejected");
    expect(connect).not.toHaveBeenCalled();
  });
  it("rejects redirect DNS into 192.168 without a second connection", async () => {
    const connect = vi.fn(async (): Promise<FetchResponse> => ({ status: 302,
      headers: { location: "https://redirect.example.test/pricing" }, stream: Readable.from([]) }));
    const fetcher = new SafeFetchAdapter({ deps: {
      resolve: async host => [{ address: host === "example.test" ? "93.184.216.34" : "192.168.255.255", family: 4 }],
      connect,
    } });
    await expect(fetcher.fetch("https://example.test/pricing", signal())).rejects.toThrow("fetch_private_address_rejected");
    expect(connect).toHaveBeenCalledTimes(1);
  });
});
