import { ApiError, validateInput, type Service, type Principal } from "./api.js";
import { validateSnapshot } from "../agent-services/pricing-snapshot.js";
import { validateDocument } from "../agent-services/document-extract.js";
import { compareSnapshots } from "../agent-services/pricing-compare.js";
export interface ExecutionContext { jobId: string; attempt: number; signal: AbortSignal }
export interface Providers {
  capture(p: Principal, sourceId: string, context?: ExecutionContext): Promise<unknown>;
  snapshot(p: Principal, id: string, context?: ExecutionContext): Promise<{ value: unknown; completeTrusted: boolean } | null>;
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
    const before = await providers.snapshot(p, input.beforeId as string, context), after = await providers.snapshot(p, input.afterId as string, context);
    if (!before || !after) throw new ApiError(404, "not_found");
    return validated(() => compareSnapshots(before.value, after.value, { beforeCompleteTrusted: before.completeTrusted === true, afterCompleteTrusted: after.completeTrusted === true }));
  }
  const fields = input.fields as string[];
  const rawDocument = await providers.extract(p, input.documentId as string, fields, context);
  const document = validated(() => validateDocument(rawDocument));
  if (document.fields.length !== fields.length || document.fields.some(f => !fields.includes(f.name))) throw new ApiError(502, "invalid_provider_output");
  return document;
}
