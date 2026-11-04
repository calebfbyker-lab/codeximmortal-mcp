import { resolve4 } from "node:dns/promises";
import { isIP } from "node:net";
import { request } from "node:https";
import { checkServerIdentity } from "node:tls";
import type { PricingResult, PricingWorker } from "./x402-routes.js";

const MAX_BYTES = 1_048_576;
const MAX_PLANS = 50;
type ObjectValue = Record<string, unknown>;
const object = (v: unknown): v is ObjectValue =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : [v];
const string = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.trim().length > 0 && v.length <= max
    ? v.trim() : null;

function normalized(raw: string): URL {
  if (raw.length > 2048) throw new Error("URL too long");
  const u = new URL(raw);
  if (u.protocol !== "https:" || u.username || u.password || u.hash ||
      (u.port && u.port !== "443") || isIP(u.hostname) ||
      u.hostname.includes(":") || !u.hostname.includes(".") ||
      u.hostname.endsWith(".")) throw new Error("Unsupported URL");
  return u;
}

// Conservative IPv4-only policy: fail closed on reserved/special ranges.
export function isPublicIPv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split(".").map(Number);
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 0 || b === 168 ||
      (b === 88 && c === 99))) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

async function fetchHtml(url: URL, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  // Resolve once and connect to a checked literal IP, avoiding a second
  // hostname lookup. Reject mixed public/private A-record responses.
  const addresses = await resolve4(url.hostname);
  signal.throwIfAborted();
  if (!addresses.length || !addresses.every(isPublicIPv4)) {
    throw new Error("DNS destination rejected");
  }
  return new Promise((resolve, reject) => {
    const req = request({
      hostname: addresses[0],
      port: 443,
      servername: url.hostname,
      checkServerIdentity: (_host, cert) => checkServerIdentity(url.hostname, cert),
      method: "GET",
      path: url.pathname + url.search,
      signal,
      headers: {
        Host: url.host,
        Accept: "text/html, application/xhtml+xml",
        "Accept-Encoding": "identity",
        "User-Agent": "CodexPricingWorker/0.1",
      },
    }, res => {
      const fail = (message: string) => {
        reject(new Error(message));
        res.destroy();
        req.destroy();
      };
      // No redirect following; approve canonical destinations explicitly.
      if (res.statusCode !== 200) { fail("Upstream status rejected"); return; }
      const type = String(res.headers["content-type"] ?? "");
      if (!/^(text\/html|application\/xhtml\+xml)(?:;|$)/i.test(type)) {
        fail("Upstream is not HTML"); return;
      }
      const encoding = res.headers["content-encoding"];
      if (encoding && encoding !== "identity") {
        fail("Compressed upstream response rejected"); return;
      }
      const charset = /charset\s*=\s*["']?([^;\s"']+)/i.exec(type)?.[1];
      if (charset && !/^utf-?8$/i.test(charset)) {
        fail("Only UTF-8 HTML is supported"); return;
      }
      const length = res.headers["content-length"];
      if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) {
        fail("Upstream body too large"); return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      res.on("error", reject);
      res.on("aborted", () => reject(new Error("Upstream interrupted")));
      res.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > MAX_BYTES) { fail("Upstream body too large"); return; }
        chunks.push(chunk);
      });
      res.on("end", () => {
        try {
          resolve(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
        } catch (error) { reject(error); }
      });
    });
    req.on("error", reject);
    req.setTimeout(10_000, () => req.destroy(new Error("Upstream timeout")));
    req.end();
  });
}

function hasType(value: ObjectValue, name: string): boolean {
  return list(value["@type"]).some(v => v === name ||
    v === `https://schema.org/${name}` || v === `http://schema.org/${name}`);
}

// Intentionally narrow: no rendering, LLM, aggregate-price ranges,
// inferred currency, inferred billing interval, or effective-price math.
export function parsePricingHtml(html: string, sourceUrl: string): PricingResult {
  if (Buffer.byteLength(html, "utf8") > MAX_BYTES) throw new Error("HTML too large");
  const plans: PricingResult["plans"] = [];
  const seen = new Set<string>();
  const scripts = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let match: RegExpExecArray | null;
  let blocks = 0;
  while ((match = scripts.exec(html)) !== null) {
    const attrs = match[1];
    if (!/(?:^|\s)type\s*=\s*(?:"application\/ld\+json"|'application\/ld\+json'|application\/ld\+json(?=\s|$))/i.test(attrs)) continue;
    if (++blocks > 32) throw new Error("Too many JSON-LD blocks");
    const raw = match[2].trim();
    // Keep the complete original JSON-LD block as evidence, not a
    // reserialized object or a fabricated rendered-text quotation.
    if (raw.length > 4000) continue;
    let document: unknown;
    try { document = JSON.parse(raw); } catch { continue; }
    let visited = 0;
    const walk = (node: unknown, inheritedName: string | null, depth: number): void => {
      if (depth > 20 || ++visited > 1000) return;
      if (Array.isArray(node)) {
        for (const item of node) walk(item, inheritedName, depth + 1);
        return;
      }
      if (!object(node)) return;
      if (hasType(node, "Offer")) {
        const name = string(node.name, 200) ?? inheritedName;
        const price = typeof node.price === "number" && Number.isFinite(node.price)
          ? String(node.price) : string(node.price, 64);
        const currency = string(node.priceCurrency, 3);
        if (name && price && /^\d+(?:\.\d+)?$/.test(price)) {
          const plan = {
            name,
            displayedAmount: price,
            currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : null,
            // Deliberately unknown: ordinary Offer data does not establish cadence.
            billingInterval: null,
            sourceExcerpt: raw,
          };
          const key = JSON.stringify([plan.name, plan.displayedAmount, plan.currency]);
          if (!seen.has(key)) {
            if (plans.length >= MAX_PLANS) throw new Error("Too many pricing offers");
            seen.add(key); plans.push(plan);
          }
        }
      }
      if (hasType(node, "Product")) {
        walk(node.offers, string(node.name, 200), depth + 1);
      }
      if (node["@graph"]) walk(node["@graph"], null, depth + 1);
    };
    walk(document, null, 0);
  }
  if (!plans.length) throw new Error("No supported structured pricing offers found");
  return { sourceUrl, extractedAt: new Date().toISOString(), plans };
}

export function createPricingWorker(approvedUrls: readonly string[]): PricingWorker {
  const approved = new Set(approvedUrls.map(raw => normalized(raw).href));
  return {
    ready: () => approved.size > 0,
    supports: url => {
      try { return approved.has(normalized(url.href).href); } catch { return false; }
    },
    async extract(raw, options) {
      const url = normalized(raw);
      if (!approved.has(url.href)) throw new Error("URL not approved");
      const signal = AbortSignal.any([options.signal, AbortSignal.timeout(15_000)]);
      signal.throwIfAborted();
      const html = await fetchHtml(url, signal);
      signal.throwIfAborted();
      return parsePricingHtml(html, url.href);
    },
  };
}

// Empty configuration fails closed. Supply a reviewed JSON array of exact
// public pricing URLs; never populate this allowlist from request input.
// Operator approval must include content/terms review and a successful dry run.
export function pricingWorkerFromEnvironment(): PricingWorker {
  const values: unknown = JSON.parse(process.env.PRICING_APPROVED_URLS ?? "[]");
  if (!Array.isArray(values) || values.length > 100 ||
      !values.every((v): v is string => typeof v === "string")) {
    throw new Error("PRICING_APPROVED_URLS must be a JSON array of up to 100 URLs");
  }
  return createPricingWorker(values);
}
