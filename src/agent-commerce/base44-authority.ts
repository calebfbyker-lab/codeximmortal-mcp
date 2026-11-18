import { ApiError, digest, identifier, validateInput, type Dependencies, type Principal, type Service } from "./api.js";
const ORIGIN = "https://codex-immortal-2c799423.base44.app";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SERVICES: Service[] = ["pricing_snapshot", "pricing_compare", "document_extract"];
const STATUS = ["queued", "running", "succeeded", "failed"];
const ERRORS: Record<number, string[]> = {
  400: ["invalid_request"], 401: ["unauthorized"],
  402: ["payment_required"], 403: ["insufficient_scope", "delegation_denied"],
  404: ["not_found"], 409: ["idempotency_conflict", "quote_expired", "quote_mismatch"],
  429: ["rate_limited"], 503: ["authority_unavailable"]
};
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new ApiError(503, "authority_invalid_response");
  return v as Record<string, unknown>;
}
function protocol(condition: unknown): asserts condition {
  if (!condition) throw new ApiError(503, "authority_invalid_response");
}
export interface AuthorityConfig {
  endpoint: string; serviceToken: string; issuer: string;
  authenticateSubject: Dependencies["authenticate"];
  consume: Dependencies["consume"];
  request?: typeof fetch;
}
// Concrete client for the NEW contract in docs/buyer-job-authority.md.
// No endpoint exists by implication: operator must provision and review the backend.
export function createBase44Dependencies(c: AuthorityConfig): Dependencies {
  const endpoint = new URL(c.endpoint);
  if (endpoint.origin !== ORIGIN || !/^\/functions\/[A-Za-z0-9_-]+$/.test(endpoint.pathname) || endpoint.search || endpoint.hash || endpoint.username || endpoint.password || !c.serviceToken || /\s/.test(c.serviceToken) || !c.issuer) throw new Error("invalid_authority_configuration");
  const request = c.request ?? fetch;
  async function call(operation: string, payload: unknown): Promise<unknown> {
    let response: Response, envelope: Record<string, unknown>;
    try {
      response = await request(endpoint, { method: "POST", redirect: "error", signal: AbortSignal.timeout(10000),
        headers: { "Content-Type": "application/json", "Accept": "application/json", "Authorization": `Bearer ${c.serviceToken}` },
        body: JSON.stringify({ version: "agent-commerce-authority-v1", operation, payload }) });
      protocol(response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() === "application/json");
      protocol(response.body);
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
      try {
        while (true) {
          const chunk = await reader.read(); if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 1048576) { await reader.cancel(); throw new Error("response_bound"); }
          chunks.push(chunk.value);
        }
      } finally { reader.releaseLock(); }
      envelope = object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))));
    } catch { throw new ApiError(503, "authority_unavailable"); }
    protocol(envelope.version === "agent-commerce-authority-v1");
    if (!response.ok) {
      const error = object(envelope.error), code = error.code;
      if (typeof code === "string" && ERRORS[response.status]?.includes(code)) {
        const retry = error.retryAfter;
        throw new ApiError(response.status, code, response.status === 429 && typeof retry === "number" && Number.isFinite(retry) ? Math.min(3600, Math.max(1, Math.ceil(retry))) : undefined);
      }
      throw new ApiError(503, "authority_unavailable");
    }
    protocol(Object.hasOwn(envelope, "data"));
    return envelope.data;
  }
  function owner(v: Record<string, unknown>, p: Principal) { protocol(v.buyerId === p.buyerId && v.clientId === p.clientId); }
  function job(v: Record<string, unknown>, p: Principal) {
    owner(v, p); protocol(typeof v.id === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(v.id));
    protocol(typeof v.status === "string" && STATUS.includes(v.status));
    return { id: v.id, status: v.status };
  }
  return {
    enabled: true,
    consume: c.consume,
    async authenticate(token) {
      const subject = await c.authenticateSubject(token);
      const v = object(await call("resolve_buyer", { issuer: c.issuer, subject: subject.buyerId, clientId: subject.clientId }));
      protocol(v.issuer === c.issuer && v.subject === subject.buyerId && v.clientId === subject.clientId && v.active === true);
      protocol(typeof v.buyerId === "string" && UUID.test(v.buyerId));
      protocol(Array.isArray(v.scopes) && v.scopes.every(s => typeof s === "string"));
      return { buyerId: v.buyerId.toLowerCase(), clientId: subject.clientId, scopes: subject.scopes.filter(s => (v.scopes as string[]).includes(s)) };
    },
    backend: {
      async quote(p, s, raw) {
        const input = validateInput(s, raw), inputDigest = digest({ service: s, input });
        const v = object(await call("quote", { buyerId: p.buyerId, clientId: p.clientId, service: s, input, inputDigest }));
        owner(v, p); protocol(v.service === s && v.inputDigest === inputDigest);
        protocol(typeof v.id === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(v.id));
        protocol(typeof v.amountMinor === "number" && Number.isSafeInteger(v.amountMinor) && v.amountMinor >= 0);
        protocol(typeof v.currency === "string" && /^[A-Z]{3}$/.test(v.currency));
        protocol(typeof v.expiresAt === "string" && Number.isFinite(Date.parse(v.expiresAt)) && Date.parse(v.expiresAt) > Date.now());
        return { id: v.id, service: s, amountMinor: v.amountMinor, currency: v.currency, expiresAt: v.expiresAt };
      },
      async submit(p, v) {
        validateInput(v.service, v.input); identifier(v.quoteId);
        protocol(v.digest === digest({ service: v.service, input: v.input, quoteId: v.quoteId }));
        const r = object(await call("submit", { buyerId: p.buyerId, clientId: p.clientId, ...v }));
        protocol(r.requestDigest === v.digest && r.service === v.service);
        // Admission can be replayed after timeout: terminal jobs are valid replay results.
        return job(r, p);
      },
      async job(p, id) {
        identifier(id);
        try { const r = object(await call("job", { buyerId: p.buyerId, clientId: p.clientId, id })); protocol(r.id === id); return job(r, p); }
        catch (e) { if (e instanceof ApiError && e.status === 404) return null; throw e; }
      },
      async result(p, id) {
        identifier(id);
        try {
          const r = object(await call("result", { buyerId: p.buyerId, clientId: p.clientId, id }));
          owner(r, p); protocol(r.jobId === id && r.status === "succeeded" && SERVICES.includes(r.service as Service));
          protocol(Object.hasOwn(r, "value") && typeof r.receiptId === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(r.receiptId));
          return { jobId: id, service: r.service, value: r.value, receiptId: r.receiptId };
        } catch (e) { if (e instanceof ApiError && e.status === 404) return null; throw e; }
      }
    }
  };
}
