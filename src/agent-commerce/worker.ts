import { ApiError, validateInput, type Service, type Principal } from "./api.js";
import { validateSnapshot } from "../agent-services/pricing-snapshot.js";
import { validateDocument } from "../agent-services/document-extract.js";
import { compareSnapshots } from "../agent-services/pricing-compare.js";
export interface Providers {
  capture(p: Principal, sourceId: string): Promise<unknown>;
  snapshot(p: Principal, id: string): Promise<{ value: unknown; completeTrusted: boolean } | null>;
  extract(p: Principal, documentId: string, fields: string[]): Promise<unknown>;
}
// Called only after authoritative durable admission. This helper never charges/settles.
export async function executeService(providers: Providers, p: Principal, service: Service, raw: unknown): Promise<unknown> {
  const input = validateInput(service, raw);
  if (service === "pricing_snapshot") return validateSnapshot(await providers.capture(p, input.sourceId as string));
  if (service === "pricing_compare") {
    const before = await providers.snapshot(p, input.beforeId as string), after = await providers.snapshot(p, input.afterId as string);
    if (!before || !after) throw new ApiError(404, "not_found");
    return compareSnapshots(before.value, after.value, { beforeCompleteTrusted: before.completeTrusted === true, afterCompleteTrusted: after.completeTrusted === true });
  }
  const fields = input.fields as string[];
  const document = validateDocument(await providers.extract(p, input.documentId as string, fields));
  if (document.fields.length !== fields.length || document.fields.some(f => !fields.includes(f.name))) throw new ApiError(502, "invalid_provider_output");
  return document;
}
