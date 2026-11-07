import { Router, json, type RequestHandler, type ErrorRequestHandler } from "express";
import { randomUUID } from "node:crypto";

export const APPROVED_BACKEND_ORIGIN = "https://codex-immortal-2c799423.base44.app";
export const WEB_TO_JSON_ACCESS_ROUTE = "/v1/web-to-json/access";
export const WEB_TO_JSON_BALANCE_ROUTE = "/v1/web-to-json/balance";
export const WEB_TO_JSON_EXTRACTION_ROUTE = "/v1/web-to-json/extractions";
export const WEB_TO_JSON_JOB_ROUTE = "/v1/web-to-json/jobs";
export const WEB_TO_JSON_POST_ROUTES = [WEB_TO_JSON_ACCESS_ROUTE, WEB_TO_JSON_BALANCE_ROUTE, WEB_TO_JSON_EXTRACTION_ROUTE, WEB_TO_JSON_JOB_ROUTE] as const;
const PATHS = { access: "web_to_json_access", balance: "web_to_json_balance", extract: "web_to_json_extract", job: "web_to_json_job" } as const;
type Operation = keyof typeof PATHS;
type Body = Record<string, unknown>;
const MAX_BYTES = 1_048_576;
const isObject = (v: unknown): v is Body => typeof v === "object" && v !== null && !Array.isArray(v);
const only = (b: Body, keys: string[]) => Object.keys(b).every(k => keys.includes(k));

async function readJson(response: Response): Promise<Body> {
  try {
    const type = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    const length = response.headers.get("content-length");
    if (!(type === "application/json" || type?.endsWith("+json")) ||
        (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) || !response.body) {
      throw new Error("invalid_response");
    }
  } catch (error) {
    await response.body?.cancel().catch(() => undefined);
    throw error;
  }
  const reader = response.body!.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BYTES) throw new Error("response_too_large");
      text += decoder.decode(chunk.value, { stream: true });
    }
    const value: unknown = JSON.parse(text + decoder.decode());
    if (!isObject(value)) throw new Error("invalid_response");
    return value;
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally { reader.releaseLock(); }
}

// Delivery adapter only: Base44 owns all accounts, credits, jobs and results.
// Mount BEFORE the application's global JSON parser. Never retry mutations.
export function createWebToJsonRouter(options: { backendOrigin?: string; fetchImpl?: typeof fetch } = {}): Router {
  const router = Router({ caseSensitive: true, strict: true });
  const enabled = (options.backendOrigin ?? process.env.WEB_TO_JSON_BACKEND_ORIGIN)?.trim() === APPROVED_BACKEND_ORIGIN;
  const request = options.fetchImpl ?? globalThis.fetch;
  router.use("/v1/web-to-json", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.locals.webToJsonRequestId = randomUUID();
    res.setHeader("X-Request-ID", res.locals.webToJsonRequestId);
    if (!enabled) { res.status(503).json({ error: "web_to_json_disabled", requestId: res.locals.webToJsonRequestId }); return; }
    next();
  });
  router.use("/v1/web-to-json", json({ limit: "8kb", strict: true }));
  function handler(operation: Operation, fromPath = false): RequestHandler {
    return (req, res) => {
      const requestId = res.locals.webToJsonRequestId as string;
      const fail = (status: number, error: string) => {
        if (!res.destroyed && !res.headersSent) res.status(status).json({ error, requestId });
      };
      void (async () => {
        if (req.method === "POST" && !req.is("application/json")) { fail(415, "application_json_required"); return; }
        const body: unknown = req.method === "GET" ? {} : req.body;
        if (!isObject(body)) { fail(400, "invalid_body"); return; }
        const payload: Body = {};
        const headers: Record<string, string> = { accept: "application/json", "content-type": "application/json" };
        if (operation !== "access") {
          const auth = req.headers.authorization;
          if (!auth || !/^Bearer w2j_[a-f0-9]{48}$/.test(auth)) { fail(401, "invalid_or_missing_bearer_key"); return; }
          headers.authorization = auth;
        }
        if (operation === "access") {
          if (!only(body, ["token", "rotate"]) || typeof body.token !== "string" || !/^[A-Za-z0-9-]{20,128}$/.test(body.token) || (body.rotate !== undefined && typeof body.rotate !== "boolean")) { fail(400, "invalid_body"); return; }
          payload.token = body.token;
          if (body.rotate !== undefined) payload.rotate = body.rotate;
        } else if (operation === "extract") {
          if (!only(body, ["url", "idempotency_key"]) || typeof body.url !== "string" || body.url.length > 2000 || typeof body.idempotency_key !== "string" || !/^[A-Za-z0-9:._-]{1,64}$/.test(body.idempotency_key)) { fail(400, "url_and_idempotency_key_required"); return; }
          let url: URL;
          try { url = new URL(body.url); } catch { fail(400, "invalid_url"); return; }
          if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) { fail(400, "unsupported_url"); return; }
          // Authoritative DNS/SSRF validation remains in the backend worker.
          payload.url = body.url; payload.idempotency_key = body.idempotency_key;
        } else if (operation === "job") {
          const id = fromPath ? req.params.id : body.id;
          if ((!fromPath && !only(body, ["id"])) || typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) { fail(400, "invalid_job_id"); return; }
          payload.id = id;
        } else if (!only(body, [])) { fail(400, "invalid_body"); return; }
        const controller = new AbortController();
        const disconnect = () => { if (!res.writableEnded) controller.abort(); };
        res.once("close", disconnect);
        let timer: ReturnType<typeof setTimeout> | undefined;
        let timedOut = false;
        try {
          const timeout = new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => { timedOut = true; controller.abort(); reject(new Error("timeout")); }, 30_000);
          });
          const work = async () => {
            const upstream = await request(new URL("/functions/" + PATHS[operation], APPROVED_BACKEND_ORIGIN), {
              method: "POST", redirect: "error", headers, body: JSON.stringify(payload), signal: controller.signal,
            });
            if ((upstream.status >= 300 && upstream.status < 400) || upstream.status >= 500) {
              await upstream.body?.cancel().catch(() => undefined); throw new Error("upstream_failure");
            }
            return { status: upstream.status, data: await readJson(upstream) };
          };
          const result = await Promise.race([work(), timeout]);
          if (!res.destroyed && !res.headersSent) res.status(result.status).json(result.data);
        } catch {
          // Failure can occur AFTER an upstream mutation. Reuse the same
          // idempotency key and retrieve the job; do not silently resubmit.
          fail(timedOut ? 504 : 502, timedOut ? "delivery_backend_timeout" : "delivery_backend_failed");
        } finally {
          if (timer) clearTimeout(timer); controller.abort(); res.off("close", disconnect);
        }
      })().catch(() => fail(500, "request_processing_failed"));
    };
  }
  router.post(WEB_TO_JSON_ACCESS_ROUTE, handler("access"));
  router.post(WEB_TO_JSON_BALANCE_ROUTE, handler("balance"));
  router.get(WEB_TO_JSON_BALANCE_ROUTE, handler("balance"));
  router.post(WEB_TO_JSON_EXTRACTION_ROUTE, handler("extract"));
  router.post(WEB_TO_JSON_JOB_ROUTE, handler("job"));
  router.get(WEB_TO_JSON_JOB_ROUTE + "/:id", handler("job", true));
  router.use("/v1/web-to-json", (_req, res) => { res.status(404).json({ error: "not_found", requestId: res.locals.webToJsonRequestId }); });
  const errors: ErrorRequestHandler = (error, _req, res, next) => {
    if (res.headersSent) { next(error); return; }
    const tooLarge = (error as { status?: number } | null)?.status === 413;
    res.status(tooLarge ? 413 : 400).json({ error: tooLarge ? "body_too_large" : "invalid_json", requestId: res.locals.webToJsonRequestId });
  };
  router.use(errors);
  return router;
}
