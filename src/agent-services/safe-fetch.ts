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

function parseIPv4(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    octets.push(value);
  }
  return octets;
}

/** Address blocklist; comprehensive IPv6 normalization remains a release prerequisite. */
export function isPublicAddress(ip: string): boolean {
  const v4 = parseIPv4(ip);
  if (v4) {
    const [a, b, c] = v4;
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
  const value = String(ip).toLowerCase();
  if (!value.includes(":")) return false;
  if (value === "::" || value === "::1") return false;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
  if (mapped) return isPublicAddress(mapped[1]);
  if (value.startsWith("fc") || value.startsWith("fd")) return false;
  if (/^fe[89ab]/.test(value)) return false;
  if (value.startsWith("ff")) return false;
  if (value.startsWith("2001:db8")) return false;
  if (value.startsWith("::")) return false;
  return true;
}

export function validateFetchUrl(value: string): URL {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) throw new SafeFetchError("invalid_fetch_url");
  let url: URL;
  try { url = new URL(value); } catch { throw new SafeFetchError("invalid_fetch_url"); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new SafeFetchError("invalid_fetch_url");
  if (!url.hostname || url.hostname.length > 253) throw new SafeFetchError("invalid_fetch_url");
  return url;
}

async function dnsResolve(hostname: string) {
  return lookup(hostname, { all: true });
}

async function resolveTarget(url: URL, resolve: NonNullable<SafeFetchDeps["resolve"]>): Promise<ResolvedTarget> {
  const records = await resolve(url.hostname).catch(() => { throw new SafeFetchError("fetch_dns_failed"); });
  if (!Array.isArray(records) || records.length === 0) throw new SafeFetchError("fetch_dns_failed");
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
      path: `${target.url.pathname}${target.url.search}`,
      method: "GET",
      servername: target.url.hostname,
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

async function readAll(stream: AsyncIterable<Uint8Array>, maxBytes: number, signal: AbortSignal): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    if (signal.aborted) throw new SafeFetchError("fetch_aborted");
    total += chunk.byteLength;
    if (total > maxBytes) throw new ApiError(422, "source_too_large");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/**
 * SafePageFetch implementation for the snapshot provider. HTTPS only,
 * DNS resolution validated against private ranges, connection pinned to the
 * validated IP (SNI preserved), bounded redirects (each fully re-validated),
 * byte and time limits, and caller-signal cancellation.
 * 4xx results are terminal provider rejections; network/timeout failures are
 * transient and left to the durable worker's retry policy.
 */
export class SafeFetchAdapter implements SafePageFetch {
  private readonly resolve: NonNullable<SafeFetchDeps["resolve"]>;
  private readonly connect: NonNullable<SafeFetchDeps["connect"]>;
  private readonly maxBytes: number;
  private readonly timeoutMs: number;
  private readonly maxRedirects: number;

  constructor(options: { maxBytes?: number; timeoutMs?: number; maxRedirects?: number; deps?: SafeFetchDeps } = {}) {
    const maxBytes = options.maxBytes ?? 512 * 1024;
    const timeoutMs = options.timeoutMs ?? 10_000;
    const maxRedirects = options.maxRedirects ?? 3;
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 8_388_608
      || !Number.isSafeInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 120_000
      || !Number.isSafeInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > 5) {
      throw new Error("invalid_fetch_configuration");
    }
    this.maxBytes = maxBytes; this.timeoutMs = timeoutMs; this.maxRedirects = maxRedirects;
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
        const target = await resolveTarget(current, this.resolve);
        const response = await this.connect(target, controller.signal);
        if (REDIRECTS.has(response.status)) {
          if (redirects >= this.maxRedirects) throw new SafeFetchError("fetch_too_many_redirects");
          const location = headerValue(response.headers, "location");
          if (!location) throw new SafeFetchError("fetch_invalid_redirect");
          current = validateFetchUrl(new URL(location, current).href);
          continue;
        }
        if (response.status === 0 || response.status >= 500) throw new SafeFetchError("fetch_upstream_unavailable");
        if (response.status < 200 || response.status >= 400) throw new ApiError(422, "invalid_source_status");
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
