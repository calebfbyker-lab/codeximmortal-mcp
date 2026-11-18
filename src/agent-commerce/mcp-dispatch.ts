import { ApiError, exact, invokeMcp, type Dependencies } from "./api.js";

type Dispatch = (name: string, args: Record<string, unknown>) => Promise<unknown>;
const COMMERCE_TOOLS = new Set([
  "codex_service_quote", "codex_job_get", "codex_result_get",
  "codex_pricing_snapshot", "codex_pricing_compare", "codex_document_extract",
]);
const SUBMIT_TOOLS = new Set([
  "codex_pricing_snapshot", "codex_pricing_compare", "codex_document_extract",
]);

// Use raw headers so duplicate Authorization fields cannot be silently collapsed.
function bearer(rawHeaders: readonly string[]): string {
  const values: string[] = [];
  for (let i = 0; i < rawHeaders.length; i += 2) {
    if (rawHeaders[i].toLowerCase() === "authorization") values.push(rawHeaders[i + 1] ?? "");
  }
  if (values.length !== 1) throw new ApiError(401, "unauthorized");
  const match = /^Bearer ([^\s]+)$/i.exec(values[0]);
  if (!match || match[1].length > 8192) throw new ApiError(401, "unauthorized");
  return match[1];
}

export function createRequestDispatcher(
  dependencies: Dependencies,
  rawHeaders: readonly string[],
  fallback: Dispatch,
): Dispatch {
  // Snapshot the request, never a shared mutable identity or header object.
  const headers = [...rawHeaders];
  return async (name, args) => {
    if (!COMMERCE_TOOLS.has(name)) return fallback(name, args);
    if (!dependencies.enabled) throw new ApiError(503, "service_disabled");
    const token = bearer(headers);
    if (SUBMIT_TOOLS.has(name)) {
      const value = exact(args, ["input", "quoteId", "idempotencyKey"]);
      if (typeof value.idempotencyKey !== "string" ||
          !/^[A-Za-z0-9_-]{16,128}$/.test(value.idempotencyKey)) {
        throw new ApiError(400, "idempotency_key_required");
      }
      return invokeMcp(dependencies, token, name,
        { input: value.input, quoteId: value.quoteId }, value.idempotencyKey);
    }
    return invokeMcp(dependencies, token, name, args);
  };
}
