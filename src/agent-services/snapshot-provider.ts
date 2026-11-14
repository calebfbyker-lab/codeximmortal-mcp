import { createHash } from "node:crypto";
import { ApiError, type Principal } from "../agent-commerce/api.js";
import { type ExecutionContext } from "../agent-commerce/worker.js";
import { validateSnapshot } from "./pricing-snapshot.js";
import type { Snapshot } from "./contracts.js";

// Injectable network boundary: production composes a real fetch adapter;
// tests inject fixtures. This module contains NO network code itself.
export interface PageFetchResult { body: string; contentType: string }

export interface SourceRecord {
  buyerId: string; sourceId: string; url: string;
  approvedForCapture: boolean;
}

export interface SnapshotSourceStore {
  // Buyer-scoped owned-source lookup. Returns null when not found or not owned.
  findOwnedSource(buyerId: string, sourceId: string): Promise<SourceRecord | null>;
}

export interface SnapshotSink {
  // Must durably persist under the buyer's identity before returning.
  persist(snapshot: Snapshot, buyerId: string, provenance: SnapshotProvenance): Promise<void>;
}

export interface SnapshotProvenance {
  sourceId: string;
  contentSha256: string;
  fetchBytes: number;
  extractedPlans: number;
  rawContentType: string;
}

export interface SafePageFetch {
  // Adapter contract: enforce HTTPS, DNS/IP and redirect policy, size and
  // time limits, and signal-driven cancellation inside the adapter.
  fetch(url: string, signal: AbortSignal): Promise<PageFetchResult>;
}

const MAX_BODY_BYTES = 512 * 1024;
const MAX_OFFERS = 100;
const MAX_SPAN_CHARS = 16384;

export class ProviderRejectedError extends ApiError {
  constructor(code: string) { super(422, code); }
}

export interface OfferSpan { start: number; end: number }

function skipWhitespace(body: string, index: number): number {
  let i = index;
  while (i < body.length) {
    const ch = body[i];
    if (ch === " " || ch < " ") i++;
    else return i;
  }
  return i;
}

function scanString(body: string, start: number): number {
  // body[start] is the opening quote; returns the index after the closing quote.
  let i = start + 1;
  while (i < body.length) {
    if (body[i] === '"') return i + 1;
    if (body[i] === '\\') { i += 2; continue; }
    i++;
  }
  throw new ProviderRejectedError("invalid_source_content");
}

function scanValue(body: string, start: number): number {
  // Returns the exclusive end index of the JSON value starting at start.
  const first = body[start];
  if (first === '"') return scanString(body, start);
  if (first === "{" || first === "[") {
    let depth = 0;
    let i = start;
    while (i < body.length) {
      const ch = body[i];
      if (ch === '"') { i = scanString(body, i); continue; }
      if (ch === "{" || ch === "[") depth++;
      else if (ch === "}" || ch === "]") {
        depth--;
        if (depth === 0) return i + 1;
      }
      i++;
    }
    throw new ProviderRejectedError("invalid_source_content");
  }
  let i = start;
  while (i < body.length) {
    const ch = body[i];
    if (ch === "," || ch === "]" || ch === "}" || ch === " " || ch < " ") return i;
    i++;
  }
  return i;
}

/**
 * Locates the original character span of every element of the offers array:
 * the top-level array, or the value of the first "offers" key of a top-level
 * object. A duplicate "offers" key is rejected because JSON.parse keeps the
 * last, which would misalign spans. Fail closed on any structural surprise.
 */
export function locateOfferSpans(body: string): OfferSpan[] {
  let i = skipWhitespace(body, 0);
  let arrayStart = -1;
  if (body[i] === "[") {
    arrayStart = i;
  } else if (body[i] === "{") {
    i++;
    while (i < body.length) {
      i = skipWhitespace(body, i);
      if (body[i] === "}") break;
      if (body[i] !== '"') throw new ProviderRejectedError("invalid_source_content");
      const keyEnd = scanString(body, i);
      let key: unknown;
      try { key = JSON.parse(body.slice(i, keyEnd)); } catch { throw new ProviderRejectedError("invalid_source_content"); }
      i = skipWhitespace(body, keyEnd);
      if (body[i] !== ":") throw new ProviderRejectedError("invalid_source_content");
      i = skipWhitespace(body, i + 1);
      const valueStart = i;
      const valueEnd = scanValue(body, i);
      if (key === "offers") {
        if (arrayStart >= 0 || body[valueStart] !== "[") throw new ProviderRejectedError("invalid_source_content");
        arrayStart = valueStart;
      }
      i = skipWhitespace(body, valueEnd);
      if (body[i] === ",") { i++; continue; }
      if (body[i] === "}") break;
      throw new ProviderRejectedError("invalid_source_content");
    }
  } else throw new ProviderRejectedError("invalid_source_content");
  if (arrayStart < 0) throw new ProviderRejectedError("invalid_source_content");
  const spans: OfferSpan[] = [];
  let cursor = skipWhitespace(body, arrayStart + 1);
  if (body[cursor] === "]") return spans;
  while (cursor < body.length) {
    const end = scanValue(body, cursor);
    if (end - cursor > MAX_SPAN_CHARS) throw new ProviderRejectedError("invalid_source_content");
    spans.push({ start: cursor, end });
    if (spans.length > MAX_OFFERS) throw new ProviderRejectedError("invalid_source_content");
    cursor = skipWhitespace(body, end);
    if (body[cursor] === ",") { cursor = skipWhitespace(body, cursor + 1); continue; }
    if (body[cursor] === "]") return spans;
    throw new ProviderRejectedError("invalid_source_content");
  }
  throw new ProviderRejectedError("invalid_source_content");
}

interface PlanRaw { name: string; amount: number | null; currency: string | null; interval: string | null; excerpt: string; sourceStart: number; sourceEnd: number }

/** Deterministic extraction from JSON-LD-like plan text blocks, paired with
 *  the original source span of each offer. Unknown values stay null; nothing
 *  is invented; the excerpt is always the original body slice, never a
 *  regenerated string. */
export function extractPlans(body: string): PlanRaw[] {
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { throw new ProviderRejectedError("invalid_source_content"); }
  const candidates = Array.isArray((parsed as { offers?: unknown })?.offers)
    ? (parsed as { offers: unknown[] }).offers
    : Array.isArray(parsed) ? parsed : [];
  if (candidates.length > MAX_OFFERS) throw new ProviderRejectedError("invalid_source_content");
  const spans = candidates.length > 0 ? locateOfferSpans(body) : [];
  if (spans.length !== candidates.length) throw new ProviderRejectedError("invalid_source_content");
  return candidates.map((offer, index) => {
    const o = offer as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name : "";
    if (!name) throw new ProviderRejectedError("invalid_source_content");
    const amount = typeof o.amount === "number" && Number.isFinite(o.amount) && o.amount >= 0 && o.amount <= 1e12 ? o.amount : null;
    const currency = typeof o.currency === "string" && /^[A-Z]{3}$/.test(o.currency) ? o.currency : null;
    const interval = typeof o.interval === "string" && o.interval.length <= 32 ? o.interval : null;
    const span = spans[index];
    return { name, amount, currency, interval, excerpt: body.slice(span.start, span.end), sourceStart: span.start, sourceEnd: span.end };
  });
}

export function buildSnapshot(
  sourceRecord: SourceRecord,
  fetchResult: PageFetchResult,
  id: string,
  now: Date,
): Snapshot {
  const bytes = Buffer.byteLength(fetchResult.body, "utf8");
  if (bytes > MAX_BODY_BYTES) throw new ProviderRejectedError("source_too_large");
  const plansRaw = extractPlans(fetchResult.body);
  const capturedAt = now.toISOString();
  // Content-derived plan identity: reordering the offers array preserves ids.
  const contentKeys = plansRaw.map(plan => plan.name + "|" + String(plan.amount) + "|" + (plan.currency ?? "XXX") + "|" + (plan.interval ?? "unknown"));
  const totals = new Map<string, number>();
  for (const key of contentKeys) totals.set(key, (totals.get(key) ?? 0) + 1);
  const seen = new Map<string, number>();
  const plans = plansRaw.map((plan, index) => {
    const key = contentKeys[index];
    const ordinal = (seen.get(key) ?? 0) + 1;
    seen.set(key, ordinal);
    const digest = createHash("sha256").update(key).digest("hex").slice(0, 12);
    const planId = (totals.get(key) ?? 1) > 1 ? "plan-" + digest + "-" + ordinal : "plan-" + digest;
    return {
      id: planId,
      name: plan.name.slice(0, 256),
      amount: plan.amount,
      currency: plan.currency ?? "XXX",
      interval: plan.interval ?? "unknown",
      evidence: plan.amount === null
        ? null
        : { text: plan.excerpt, token: String(plan.amount), sourceStart: plan.sourceStart, sourceEnd: plan.sourceEnd },
    };
  });
  const coverage = plansRaw.length > 0
    && plansRaw.every(p => p.amount !== null && p.currency !== null && p.interval !== null)
    ? "complete" : "partial";
  return validateSnapshot({
    id, sourceUrl: sourceRecord.url, capturedAt, coverage, plans,
  });
}

/** pricing_snapshot provider for the durable worker's executeService. */
export class SnapshotProvider {
  constructor(
    private readonly sources: SnapshotSourceStore,
    private readonly fetcher: SafePageFetch,
    private readonly sink: SnapshotSink,
    private readonly clock: () => Date = () => new Date(),
  ) {
    if (!sources || !fetcher || !sink) throw new Error("invalid_provider_configuration");
  }

  async capture(p: Principal, sourceId: string, context?: ExecutionContext): Promise<unknown> {
    context?.signal.throwIfAborted();
    const owned = await this.sources.findOwnedSource(p.buyerId, sourceId);
    if (!owned || !owned.approvedForCapture) throw new ApiError(404, "not_found");
    context?.signal.throwIfAborted();
    const fetchResult = await this.fetcher.fetch(owned.url, context?.signal ?? new AbortController().signal);
    context?.signal.throwIfAborted();
    const id = context?.jobId ? `snap-${context.jobId}` : `snap-${createHash("sha256").update(sourceId + p.buyerId).digest("hex").slice(0, 16)}`;
    const snapshot = buildSnapshot(owned, fetchResult, id, this.clock());
    const provenance: SnapshotProvenance = {
      sourceId: owned.sourceId,
      contentSha256: createHash("sha256").update(fetchResult.body, "utf8").digest("hex"),
      fetchBytes: Buffer.byteLength(fetchResult.body, "utf8"),
      extractedPlans: snapshot.plans.length,
      rawContentType: fetchResult.contentType.slice(0, 128),
    };
    await this.sink.persist(snapshot, p.buyerId, provenance);
    return snapshot;
  }
}
