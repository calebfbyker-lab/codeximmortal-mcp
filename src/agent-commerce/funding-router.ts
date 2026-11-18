import { Router, json, type ErrorRequestHandler, type RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { ApiError, exact, identifier, type Dependencies, type Principal } from "./api.js";

export interface DepositInstructions {
  orderId: string;
  reference: string;
  status: "awaiting_payment" | "credited" | "expired";
  network: string;
  asset: { symbol: string; contract: string; decimals: number };
  recipient: string;
  amountAtomic: string;
  credit: { amountMinor: string; currency: string };
  expiresAt: string;
}

export interface FundingOrderBackend {
  /**
   * Must atomically recheck the active buyer and delegation with funding
   * permission, resolve the package from approved server configuration,
   * enforce open-intent limits, persist the buyer/client-bound deposit
   * intent and its idempotency record, and return deposit instructions.
   * Same key and package returns the original instructions; a different
   * package under the same key is a conflict. Never credits balances and
   * never trusts caller-supplied deposit evidence.
   */
  create(principal: Principal, input: { packageId: string; idempotencyKey: string }): Promise<{ created: boolean; instructions: DepositInstructions }>;
}

export interface FundingRouterDependencies {
  enabled: boolean;
  authenticate: Dependencies["authenticate"];
  consume: Dependencies["consume"];
  backend: FundingOrderBackend;
}

/**
 * Agent-facing funding API. Deliberately has no catch-all 404 so it can be
 * mounted at the same prefix as the commerce router and fall through to it.
 * The body parser runs after authentication so unauthenticated request bodies
 * are never parsed. No route here credits a balance or accepts deposit
 * evidence: money verification belongs to the deposit adapter, accounting to
 * the funding core.
 */
export function createAgentFundingRouter(d: FundingRouterDependencies) {
  const router = Router();
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Request-ID", randomUUID());
    next();
  });
  const authorize: RequestHandler = (req, res, next) => {
    void (async () => {
      if (!d.enabled) throw new ApiError(503, "funding_disabled");
      const match = /^Bearer ([^\s]+)$/i.exec(req.get("Authorization") ?? "");
      if (!match || match[1].length > 8192) throw new ApiError(401, "unauthorized");
      const p = await d.authenticate(match[1]);
      if (!p.buyerId || !p.clientId || !Array.isArray(p.scopes)) throw new ApiError(401, "unauthorized");
      if (!p.scopes.includes("funding:create")) throw new ApiError(403, "insufficient_scope");
      const budget = await d.consume(p.buyerId, p.clientId, "funding_create");
      if (!budget.allowed) throw new ApiError(429, "rate_limited", Number.isFinite(budget.retryAfter) ? Math.max(1, Math.ceil(budget.retryAfter)) : 60);
      if (req.method === "POST" && !req.is("application/json")) throw new ApiError(415, "unsupported_media_type");
      res.locals.fundingPrincipal = p;
      next();
    })().catch(next);
  };
  const create: RequestHandler = (req, res, next) => {
    void (async () => {
      const v = exact(req.body, ["packageId"]);
      const packageId = identifier(v.packageId);
      const key = req.get("Idempotency-Key");
      if (!key || !/^[A-Za-z0-9_-]{16,128}$/.test(key)) throw new ApiError(400, "idempotency_key_required");
      const result = await d.backend.create(res.locals.fundingPrincipal as Principal, { packageId, idempotencyKey: key });
      res.status(result.created ? 201 : 200).json({ data: result.instructions, requestId: res.getHeader("X-Request-ID") });
    })().catch(next);
  };
  router.post("/funding/orders", authorize, json({ limit: "4kb", strict: true, inflate: false }), create);
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    const status = Number((error as { status?: number })?.status);
    const e = error instanceof ApiError ? error : [400, 413, 415].includes(status) ? new ApiError(status, "invalid_request") : new ApiError(503, "funding_unavailable");
    if (e.status === 401) res.setHeader("WWW-Authenticate", 'Bearer realm="codeximmortal"');
    if (e.retryAfter) res.setHeader("Retry-After", String(e.retryAfter));
    res.status(e.status).json({ error: { code: e.code, retryable: [429, 503].includes(e.status) }, requestId: res.getHeader("X-Request-ID") });
  };
  router.use(errors);
  return router;
}
