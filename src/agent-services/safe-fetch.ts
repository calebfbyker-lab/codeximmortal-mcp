import { request as httpsRequest } from "node:https";
import { lookup } from "node:dns/promises";
import { ApiError } from "../agent-commerce/api.js";
import type { PageFetchResult, SafePageFetch } from "./snapshot-provider.js";

/** Transient fetch failure: the durable worker retries these. */
export class SafeFetchError extends Error {
  constructor(code: string) { super(code); this.name = "SafeFetchError"; }
}

export interface ResolvedTarget { url: URL; ip: string }
export interface FetchResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  stream: AsyncIterable<Uint8Array>;
}
export interface SafeFetchDeps {
  resolve?(hostname: string): Promise<Array<{ address: string; family: number }>>;
  connect?(target: ResolvedTarget, signal: AbortSignal): Promise<FetchResponse>;
}

function parseIPv4Bytes(ip: string): number[] | null {
  const parts = String(ip).split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (part.length < 1 || part.length > 3) return null;
    for (const ch of part) if (ch < "0" || ch > "9") return null;
    const value = Number(part);
    if (value > 255) return null;
    octets.push(value);
  }
  return octets;
}

const HEX_DIGITS = "0123456789abcdef";

function parseHextet(group: string): number | null {
  if (group.length < 1 || group.length > 4) return null;
  let value = 0;
  for (const ch of group) {
    const digit = HEX_DIGITS.indexOf(ch);
    if (digit < 0) return null;
    value = value * 16 + digit;
  }
  return value;
}

/**
 * Byte-exact IPv6 parser: accepts compressed "::" and embedded IPv4 notation,
 * strips zone identifiers, and rejects anything malformed. Parsed character by
 * character with no regexes so exotic spellings cannot smuggle past checks.
 * Returns the 16 address bytes, or null when the input is not an IPv6 address.
 */
export function parseIPv6Bytes(input: string): number[] | null {
  let text = String(input).toLowerCase().trim();
  const zone = text.indexOf("%");
  if (zone >= 0) text = text.slice(0, zone);
  if (!text.includes(":")) return null;
  let v4tail: number[] | null = null;
  if (text.includes(".")) {
    const colon = text.lastIndexOf(":");
    v4tail = parseIPv4Bytes(text.slice(colon + 1));
    if (!v4tail) return null;
    text = text.slice(0, colon) + ":0:0";
  }
  const doubleAt = text.indexOf("::");
  const hasDouble = doubleAt >= 0;
  if (hasDouble && text.split("::").length > 2) return null;
  const before = hasDouble ? text.slice(0, doubleAt) : text;
  const after = hasDouble ? text.slice(doubleAt + 2) : "";
  const head = before.length > 0 ? before.split(":") : [];
  const tail = after.length > 0 ? after.split(":") : [];
  if (head.some(group => group.length === 0) || tail.some(group => group.length === 0)) return null;
  if (hasDouble ? head.length + tail.length > 7 : head.length !== 8) return null;
  const hextets: number[] = [];
  for (const group of head) {
    const value = parseHextet(group);
    if (value === null) return null;
    hextets.push(value);
  }
  if (hasDouble) while (hextets.length < 8 - tail.length) hextets.push(0);
  for (const group of tail) {
    const value = parseHextet(group);
    if (value === null) return null;
    hextets.push(value);
  }
  if (hextets.length !== 8) return null;
  if (v4tail) {
    hextets[6] = (v4tail[0] << 8) | v4tail[1];
    hextets[7] = (v4tail[2] << 8) | v4tail[3];
  }
  const bytes: number[] = [];
  for (const value of hextets) bytes.push(value >> 8, value & 0xff);
  return bytes;
}

function ipv4IsPublic(octets: number[]): boolean {
  const [a, b, c] = octets;
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  if (a >= 224) return false;
  return true;
}

const allZero = (bytes: number[]) => bytes.every(byte => byte === 0);

/**
 * Destination policy, byte-exact and fail closed: anything that does not parse
 * is treated as private. IPv4-mapped, IPv4-compatible, NAT64 and 6to4 forms are
 * reduced to their embedded IPv4 payload and classified; loopback, Teredo,
 * discard-only, documentation, ULA, link-local, site-local and multicast ranges
 * are always blocked.
 */
export function isPublicAddress(ip: string): boolean {
  const v4 = parseIPv4Bytes(ip);
  if (v4) return ipv4IsPublic(v4);
  const bytes = parseIPv6Bytes(ip);
  if (!bytes) return false;
  if (allZero(bytes)) return false;
  if (allZero(bytes.slice(0, 12))) return ipv4IsPublic(bytes.slice(12));
  if (allZero(bytes.slice(0, 10)) && bytes[10] === 0xff && bytes[11] === 0xff) return ipv4IsPublic(bytes.slice(12));
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b && allZero(bytes.slice(4, 12))) return ipv4IsPublic(bytes.slice(12));
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return ipv4IsPublic(bytes.slice(2, 6));
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00) return false;
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return false;
  if (bytes[0] === 0x01 && allZero(bytes.slice(1, 8))) return false;
  if ((bytes[0] & 0xfe) === 0xfc) return false;
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return false;
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0xc0) return false;
  if (bytes[0] === 0xff) return false;
  return true;
}

export function validateFetchUrl(value: string): URL {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) throw new SafeFetchError("invalid_fetch_url");
  let url: URL;
  try { url = new URL(value); } catch { throw new SafeFetchError("invalid_fetch_url"); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new SafeFetchError("invalid_fetch_url");
  if (!url.hostname || url.hostname.length > 253) throw new SafeFetchError("invalid_fetch_url");
  if (url.port) {
    const port = Number(url.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new SafeFetchError("invalid_fetch_url");
  }
  return url;
}

async function dnsResolve(hostname: string) {
  return lookup(hostname, { all: true });
}

async function resolveTarget(url: URL, resolve: NonNullable<SafeFetchDeps["resolve"]>, dnsTimeoutMs: number, maxRecords: number): Promise<ResolvedTarget> {
  const hostname = url.hostname;
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    const literal = hostname.slice(1, -1);
    if (!isPublicAddress(literal)) throw new SafeFetchError("fetch_private_address_rejected");
    return { url, ip: literal };
  }
  let timer: NodeJS.Timeout | undefined;
  let records: Array<{ address: string; family: number }>;
  try {
    records = await Promise.race([
      resolve(hostname).catch(() => { throw new SafeFetchError("fetch_dns_failed"); }),
      new Promise<Array<{ address: string; family: number }>>((_resolve, reject) => {
        timer = setTimeout(() => reject(new SafeFetchError("fetch_dns_failed")), dnsTimeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  if (!Array.isArray(records) || records.length === 0) throw new SafeFetchError("fetch_dns_failed");
  if (records.length > maxRecords) throw new SafeFetchError("fetch_dns_failed");
  const addresses = records.map(record => record?.address).filter((address): address is string => typeof address === "string");
  if (addresses.length !== records.length || !addresses.every(isPublicAddress)) {
    throw new SafeFetchError("fetch_private_address_rejected");
  }
  // Pin the validated IP: the connection cannot be re-bound to another address.
  return { url, ip: addresses[0] };
}

function httpsConnect(target: ResolvedTarget, signal: AbortSignal): Promise<FetchResponse> {
  return new Promise<FetchResponse>((resolve, reject) => {
    const request = httpsRequest({
      host: target.ip,
      port: target.url.port ? Number(target.url.port) : 443,
      path: target.url.pathname + target.url.search,
      method: "GET",
      servername: target.url.hostname,
      minVersion: "TLSv1.2",
      rejectUnauthorized: true,
      ALPNProtocols: ["http/1.1"],
      signal,
      headers: {
        host: target.url.host,
        accept: "application/json, text/plain;q=0.9",
        "user-agent": "codeximmortal-mcp-snapshot/1.0",
      },
    }, response => {
      resolve({ status: response.statusCode ?? 0, headers: response.headers, stream: response });
    });
    request.on("error", reject);
    request.end();
  });
}

function headerValue(headers: FetchResponse["headers"], name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function disposeStream(stream: AsyncIterable<Uint8Array>): void {
  const disposable = stream as unknown as { destroy?: (error?: Error) => void };
  try { disposable.destroy?.(new Error("fetch_stream_disposed")); } catch { /* disposal is best effort */ }
}

async function readAll(stream: AsyncIterable<Uint8Array>, maxBytes: number, signal: AbortSignal): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of stream) {
      if (signal.aborted) throw new SafeFetchError("fetch_aborted");
      total += chunk.byteLength;
      if (total > maxBytes) throw new ApiError(422, "source_too_large");
      chunks.push(Buffer.from(chunk));
    }
  } catch (error) {
    disposeStream(stream);
    throw error;
  }
  return Buffer.concat(chunks).toString("utf8");
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/**
 * SafePageFetch implementation for the snapshot provider. HTTPS only, DNS
 * resolution bounded (time and record count) and validated against the
 * byte-exact private-range policy, connection pinned to the validated IP with
 * SNI preserved and TLS 1.2 as the floor, the connect call raced against abort
 * so a non-settling connection can never stall the fetch, bounded redirects
 * each fully re-validated, response streams disposed on redirect, abort and
 * failure, byte and time limits, and caller-signal cancellation. 4xx results
 * are terminal provider rejections; network/timeout failures are transient
 * and left to the durable worker's retry policy.
 */
export class SafeFetchAdapter implements SafePageFetch {
  private readonly resolve: NonNullable<SafeFetchDeps["resolve"]>;
  private readonly connect: NonNullable<SafeFetchDeps["connect"]>;
  private readonly maxBytes: number;
  private readonly timeoutMs: number;
  private readonly maxRedirects: number;
  private readonly dnsTimeoutMs: number;
  private readonly maxDnsRecords: number;

  constructor(options: { maxBytes?: number; timeoutMs?: number; maxRedirects?: number; dnsTimeoutMs?: number; maxDnsRecords?: number; deps?: SafeFetchDeps } = {}) {
    const maxBytes = options.maxBytes ?? 512 * 1024;
    const timeoutMs = options.timeoutMs ?? 10_000;
    const maxRedirects = options.maxRedirects ?? 3;
    const dnsTimeoutMs = options.dnsTimeoutMs ?? 5_000;
    const maxDnsRecords = options.maxDnsRecords ?? 32;
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 8_388_608
      || !Number.isSafeInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 120_000
      || !Number.isSafeInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > 5
      || !Number.isSafeInteger(dnsTimeoutMs) || dnsTimeoutMs < 250 || dnsTimeoutMs > 60_000
      || !Number.isSafeInteger(maxDnsRecords) || maxDnsRecords < 1 || maxDnsRecords > 256) {
      throw new Error("invalid_fetch_configuration");
    }
    this.maxBytes = maxBytes; this.timeoutMs = timeoutMs; this.maxRedirects = maxRedirects;
    this.dnsTimeoutMs = dnsTimeoutMs; this.maxDnsRecords = maxDnsRecords;
    this.resolve = options.deps?.resolve ?? dnsResolve;
    this.connect = options.deps?.connect ?? httpsConnect;
  }

  async fetch(url: string, signal: AbortSignal): Promise<PageFetchResult> {
    const callerSignal = signal ?? new AbortController().signal;
    if (callerSignal.aborted) throw new SafeFetchError("fetch_aborted");
    const controller = new AbortController();
    let timedOut = false;
    const onAbort = () => controller.abort();
    callerSignal.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeoutMs);
    try {
      let current = validateFetchUrl(url);
      for (let redirects = 0; ; redirects++) {
        const target = await resolveTarget(current, this.resolve, this.dnsTimeoutMs, this.maxDnsRecords);
        // Race the connection against abort so a non-settling connect can
        // never stall the fetch; the durable worker's outer timeout is a
        // backstop, not the only defense.
        const response = await Promise.race([
          this.connect(target, controller.signal),
          new Promise<never>((_resolve, reject) => {
            controller.signal.addEventListener("abort", () => reject(new SafeFetchError(timedOut ? "fetch_timeout" : "fetch_aborted")), { once: true });
          }),
        ]);
        if (REDIRECTS.has(response.status)) {
          disposeStream(response.stream);
          if (redirects >= this.maxRedirects) throw new SafeFetchError("fetch_too_many_redirects");
          const location = headerValue(response.headers, "location");
          if (!location) throw new SafeFetchError("fetch_invalid_redirect");
          current = validateFetchUrl(new URL(location, current).href);
          continue;
        }
        if (response.status === 0 || response.status >= 500) {
          disposeStream(response.stream);
          throw new SafeFetchError("fetch_upstream_unavailable");
        }
        if (response.status < 200 || response.status >= 400) {
          disposeStream(response.stream);
          throw new ApiError(422, "invalid_source_status");
        }
        const body = await readAll(response.stream, this.maxBytes, controller.signal);
        const contentType = headerValue(response.headers, "content-type") ?? "application/octet-stream";
        return { body, contentType: contentType.slice(0, 128) };
      }
    } catch (error) {
      if (timedOut && !(error instanceof ApiError)) throw new SafeFetchError("fetch_timeout");
      throw error;
    } finally {
      clearTimeout(timer);
      callerSignal.removeEventListener("abort", onAbort);
    }
  }
}
