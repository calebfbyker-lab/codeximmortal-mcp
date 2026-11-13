import { createHash } from "node:crypto";
import type { Principal } from "../agent-commerce/api.js";
import { ApiError, type ExecutionContext } from "../agent-commerce/worker.js";
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

export class ProviderRejectedError extends ApiError {
  constructor(code: string) { super(422, code); }
}

interface PlanRaw { name: string; amount: number | null; currency: string | null; interval: string | null; excerpt: string }

/** Deterministic extraction from JSON-LD-like plan text blocks.
 *  Unknown values stay null; nothing is invented. */
export function extractPlans(body: string): PlanRaw[] {
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { throw new ProviderRejectedError("invalid_source_content"); }
  const candidates = Array.isArray((parsed as { offers?: unknown })?.offers)
    ? (parsed as { offers: unknown[] }).offers
    : Array.isArray(parsed) ? parsed : [];
  if (candidates.length > 100) throw new ProviderRejectedError("invalid_source_content");
  return candidates.map(offer => {
    const o = offer as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name : "";
    if (!name) throw new ProviderRejectedError("invalid_source_content");
    const amount = typeof o.amount === "number" && Number.isFinite(o.amount) && o.amount >= 0 && o.amount <= 1e12 ? o.amount : null;
    const currency = typeof o.currency === "string" && /^[A-Z]{3}$/.test(o.currency) ? o.currency : null;
    const interval = typeof o.interval === "string" && o.interval.length <= 32 ? o.interval : null;
    const excerpt = `name=${name} amount=${amount === null ? "unknown" : String(amount)} currency=${currency ?? "unknown"}`;
    return { name, amount, currency, interval, excerpt };
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
  const plans = plansRaw.map((plan, index) => ({
    id: `plan-${index + 1}`,
    name: plan.name.slice(0, 256),
    amount: plan.amount,
    currency: plan.currency ?? "XXX",
    interval: plan.interval ?? "unknown",
    evidence: plan.amount === null ? null : { text: plan.excerpt.slice(0, 16384), token: String(plan.amount) },
  }));
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
