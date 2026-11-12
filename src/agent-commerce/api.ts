import express, { type ErrorRequestHandler } from "express";
import { createHash, randomUUID } from "node:crypto";
export type Service = "pricing_snapshot" | "pricing_compare" | "document_extract";
export interface Principal { buyerId: string; clientId: string; scopes: string[] }
export class ApiError extends Error {
  constructor(public status: number, public code: string, public retryAfter?: number) { super(code); }
}
export interface Dependencies {
  enabled: boolean;
  authenticate(token: string): Promise<Principal>;
  consume(buyer: string, client: string, operation: string): Promise<{ allowed: boolean; retryAfter: number }>;
  backend: {
    quote(p: Principal, service: Service, input: Record<string, unknown>): Promise<unknown>;
    // MUST atomically enforce quote/delegation, reserve entitlement, persist job,
    // idempotency record and outbox. Same key/digest returns original; conflict ->409.
    submit(p: Principal, value: { service: Service; input: Record<string, unknown>; quoteId: string; idempotencyKey: string; digest: string }): Promise<unknown>;
    job(p: Principal, id: string): Promise<unknown | null>;
    result(p: Principal, id: string): Promise<unknown | null>;
  };
}
export function exact(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, "invalid_request");
  const v = value as Record<string, unknown>;
  if (Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) throw new ApiError(400, "invalid_request");
  return v;
}
export function identifier(v: unknown): string {
  if (typeof v !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(v)) throw new ApiError(400, "invalid_identifier");
  return v;
}
function service(v: unknown): Service {
  if (v !== "pricing_snapshot" && v !== "pricing_compare" && v !== "document_extract") throw new ApiError(400, "unknown_service");
  return v;
}
export function validateInput(s: Service, value: unknown): Record<string, unknown> {
  if (s === "pricing_snapshot") { const v = exact(value, ["sourceId"]); return { sourceId: identifier(v.sourceId) }; }
  if (s === "pricing_compare") { const v = exact(value, ["beforeId", "afterId"]); return { beforeId: identifier(v.beforeId), afterId: identifier(v.afterId) }; }
  const v = exact(value, ["documentId", "profile", "fields"]);
  if (v.profile !== "scalar-fields-v1" || !Array.isArray(v.fields) || v.fields.length < 1 || v.fields.length > 100) throw new ApiError(400, "invalid_document_request");
  const fields = v.fields.map(identifier);
  if (new Set(fields).size !== fields.length) throw new ApiError(400, "duplicate_field_name");
  return { documentId: identifier(v.documentId), profile: v.profile, fields };
}
export function digest(v: unknown): string {
  function canonical(x: unknown): unknown {
    if (Array.isArray(x)) return x.map(canonical);
    if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)).map(([k, y]) => [k, canonical(y)]));
    return x;
  }
  return createHash("sha256").update(JSON.stringify(canonical(v))).digest("hex");
}
const SCOPES: Record<string, string> = { quote: "commerce:quote", submit: "services:execute", job: "jobs:read", result: "results:read" };
export async function invoke(d: Dependencies, token: string, operation: string, raw: unknown, key?: string): Promise<unknown> {
  if (!d.enabled) throw new ApiError(503, "service_disabled");
  if (!token || token.length > 8192) throw new ApiError(401, "unauthorized");
  const p = await d.authenticate(token);
  if (!p.buyerId || !p.clientId || !Array.isArray(p.scopes)) throw new ApiError(401, "unauthorized");
  const scope = Object.hasOwn(SCOPES, operation) ? SCOPES[operation] : undefined;
  if (!scope) throw new ApiError(400, "unknown_operation");
  if (!p.scopes.includes(scope)) throw new ApiError(403, "insufficient_scope");
  const budget = await d.consume(p.buyerId, p.clientId, operation);
  if (!budget.allowed) throw new ApiError(429, "rate_limited", Number.isFinite(budget.retryAfter) ? Math.max(1, Math.ceil(budget.retryAfter)) : 60);
  if (operation === "job" || operation === "result") {
    const v = exact(raw, ["id"]), found = await d.backend[operation](p, identifier(v.id));
    if (found === null) throw new ApiError(404, "not_found");
    return found;
  }
  const v = exact(raw, operation === "quote" ? ["service", "input"] : ["service", "input", "quoteId"]);
  const s = service(v.service), input = validateInput(s, v.input);
  if (operation === "quote") return d.backend.quote(p, s, input);
  if (!key || !/^[A-Za-z0-9_-]{16,128}$/.test(key)) throw new ApiError(400, "idempotency_key_required");
  const quoteId = identifier(v.quoteId);
  return d.backend.submit(p, { service: s, input, quoteId, idempotencyKey: key, digest: digest({ service: s, input, quoteId }) });
}
export function createAgentCommerceRouter(d: Dependencies) {
  const router = express.Router();
  router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); res.setHeader("X-Request-ID", randomUUID()); next(); });
  router.use((_req, _res, next) => { next(d.enabled ? undefined : new ApiError(503, "service_disabled")); });
  router.use(express.json({ limit: "32kb", strict: true, inflate: false }));
  const route = (operation: string) => async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    try {
      const match = /^Bearer ([^\s]+)$/i.exec(req.get("Authorization") ?? "");
      if (!match) throw new ApiError(401, "unauthorized");
      if (req.method === "POST" && !req.is("application/json")) throw new ApiError(415, "unsupported_media_type");
      const data = await invoke(d, match[1], operation, req.method === "GET" ? { id: req.params.id } : req.body, req.get("Idempotency-Key"));
      res.status(operation === "submit" ? 202 : 200).json({ data, requestId: res.getHeader("X-Request-ID") });
    } catch (e) { next(e); }
  };
  router.post("/quotes", route("quote"));
  router.post("/jobs", route("submit"));
  router.get("/jobs/:id", route("job"));
  router.get("/jobs/:id/result", route("result"));
  router.use((_req, _res, next) => next(new ApiError(404, "not_found")));
  const errors: ErrorRequestHandler = (err, _req, res, _next) => {
    const status = Number((err as { status?: number })?.status);
    const e = err instanceof ApiError ? err : [400, 413, 415].includes(status) ? new ApiError(status, "invalid_request") : new ApiError(503, "dependency_unavailable");
    if (e.status === 401) res.setHeader("WWW-Authenticate", 'Bearer realm="codeximmortal"');
    if (e.retryAfter) res.setHeader("Retry-After", String(e.retryAfter));
    res.status(e.status).json({ error: { code: e.code, retryable: [429, 503].includes(e.status) }, requestId: res.getHeader("X-Request-ID") });
  };
  router.use(errors);
  return router;
}
export async function invokeMcp(d: Dependencies, bearer: string, tool: string, args: unknown, key?: string) {
  if (tool === "codex_service_quote") return invoke(d, bearer, "quote", args);
  if (tool === "codex_job_get" || tool === "codex_result_get") return invoke(d, bearer, tool === "codex_job_get" ? "job" : "result", args);
  const names: Record<string, Service> = { codex_pricing_snapshot: "pricing_snapshot", codex_pricing_compare: "pricing_compare", codex_document_extract: "document_extract" };
  if (!Object.hasOwn(names, tool)) throw new ApiError(400, "unknown_tool");
  return invoke(d, bearer, "submit", { ...exact(args, ["input", "quoteId"]), service: names[tool] }, key);
}
