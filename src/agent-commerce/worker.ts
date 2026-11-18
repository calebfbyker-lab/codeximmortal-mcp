import { ApiError, validateInput, type Service, type Principal } from "./api.js";
import { validateSnapshot } from "../agent-services/pricing-snapshot.js";
import { validateDocument } from "../agent-services/document-extract.js";
import { compareSnapshots } from "../agent-services/pricing-compare.js";
import { canonicalJson } from "../agent-services/contracts.js";
export interface ExecutionContext { jobId: string; attempt: number; signal: AbortSignal }
export interface SnapshotRead { value: unknown; completeTrusted: boolean }
export interface Providers {
  capture(p: Principal, sourceId: string, context?: ExecutionContext): Promise<unknown>;
  snapshot(p: Principal, id: string, context?: ExecutionContext): Promise<SnapshotRead | null>;
  // Optional single consistent read of a comparison pair; when absent the
  // worker falls back to sequential reads verified by re-read.
  snapshotPair?(p: Principal, beforeId: string, afterId: string, context?: ExecutionContext): Promise<{ before: SnapshotRead | null; after: SnapshotRead | null }>;
  extract(p: Principal, documentId: string, fields: string[], context?: ExecutionContext): Promise<unknown>;
}
// Provider exceptions remain transient unless explicitly classified by the provider.
function validated<T>(fn: () => T): T {
  try { return fn(); } catch { throw new ApiError(502, "invalid_provider_output"); }
}
// Execution only: durable worker owns all accounting and settlement.
export async function executeService(providers: Providers, p: Principal, service: Service, raw: unknown, context?: ExecutionContext): Promise<unknown> {
  const input = validateInput(service, raw);
  if (service === "pricing_snapshot") {
    const value = await providers.capture(p, input.sourceId as string, context);
    return validated(() => validateSnapshot(value));
  }
  if (service === "pricing_compare") {
    const beforeId = input.beforeId as string, afterId = input.afterId as string;
    let before: SnapshotRead | null, after: SnapshotRead | null;
    if (providers.snapshotPair) {
      // Single consistent read of both snapshots.
      const pair = await providers.snapshotPair(p, beforeId, afterId, context);
      before = pair.before;
      after = pair.after;
    } else {
      // Consistent paired reads: snapshots are immutable rows, so re-reading
      // both must return identical values. Any drift between the read and
      // the verification read means the store view is inconsistent.
      before = await providers.snapshot(p, beforeId, context);
      after = await providers.snapshot(p, afterId, context);
      const beforeAgain = await providers.snapshot(p, beforeId, context);
      const afterAgain = await providers.snapshot(p, afterId, context);
      if (canonicalJson(before) !== canonicalJson(beforeAgain) || canonicalJson(after) !== canonicalJson(afterAgain)) {
        throw new ApiError(502, "inconsistent_snapshot_pair");
      }
    }
    if (!before || !after) throw new ApiError(404, "not_found");
    // Coverage trust must be explicit: unverified complete coverage never
    // licenses plan_added/plan_removed inferences in compareSnapshots.
    return validated(() => compareSnapshots(before.value, after.value, { beforeCompleteTrusted: before.completeTrusted === true, afterCompleteTrusted: after.completeTrusted === true }));
  }
  const fields = input.fields as string[];
  const rawDocument = await providers.extract(p, input.documentId as string, fields, context);
  const document = validated(() => validateDocument(rawDocument));
  if (document.fields.length !== fields.length || document.fields.some(f => !fields.includes(f.name))) throw new ApiError(502, "invalid_provider_output");
  return document;
}
