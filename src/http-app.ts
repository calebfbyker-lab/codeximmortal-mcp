import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer, type ToolDef } from "./server.js";
import type { Catalog } from "./catalog.js";
import { createAgentCommerceRouter, type Dependencies } from "./agent-commerce/api.js";
import { createRequestDispatcher } from "./agent-commerce/mcp-dispatch.js";

export interface HttpAppOptions {
  tools: ToolDef[];
  catalog: Catalog;
  agentCardJson: string;
  commerce: Dependencies;
  dispatch: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  storefrontRouter: RequestHandler;
  pricingRoute: string;
  pricingRouter?: RequestHandler;
}

// No environment reads, database pools, provider creation, or listening here.
export function createHttpApp(options: HttpAppOptions) {
  const app = express();
  const PRICING_ROUTE = options.pricingRoute;
  app.disable("x-powered-by");
  // Existing prepaid storefront owns its parser and remains a separate authority.
  app.use(options.storefrontRouter);
  app.use("/api/v1/agent", createAgentCommerceRouter(options.commerce));
  app.post(PRICING_ROUTE, express.json({ limit: "8kb", strict: true }));
  app.use(express.json());

  app.get("/.well-known/agent-card.json", (_req, res) => {
    res.type("application/json").send(options.agentCardJson);
  });
  app.get("/api/v1/catalog.json", (_req, res) => {
    res.type("application/json").send(JSON.stringify(options.catalog));
  });
  app.post("/mcp", async (req, res) => {
    const server = createServer(options.tools,
      createRequestDispatcher(options.commerce, req.rawHeaders, options.dispatch));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.once("close", () => {
      void transport.close().catch(() => undefined);
      void server.close().catch(() => undefined);
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      console.error(JSON.stringify({ event: "mcp_request_failed" }));
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", id: null,
          error: { code: -32603, message: "mcp_request_failed" } });
      } else if (!res.writableEnded) {
        res.end();
      }
    }
  });
  app.get("/mcp", (_req, res) => {
    res.setHeader("Allow", "POST");
    res.status(405).json({ jsonrpc: "2.0", id: null,
      error: { code: -32000, message: "method_not_allowed" } });
  });
  app.get("/healthz", (_req, res) => {
    // Liveness only: not payment, provider, database, or worker readiness.
    res.json({ ok: true, tools: options.tools.length, offers: options.catalog.offers.length });
  });
  // Existing routes precede pricing payment middleware, as in the runtime.
  if (options.pricingRouter) app.use(options.pricingRouter);
  else app.post(PRICING_ROUTE, (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.status(503).json({ error: "x402_disabled" });
  });
  const errors: ErrorRequestHandler = (error, _req, res, next) => {
    if (res.headersSent) { next(error); return; }
    const status = (error as { status?: number } | null)?.status;
    const clientError = status === 400 || status === 413 || status === 415;
    console.error(JSON.stringify({ event: "http_request_failed",
      requestId: res.locals.x402RequestId ?? null }));
    res.setHeader("Cache-Control", "no-store");
    res.status(clientError ? status : 500).json({
      error: clientError ? "invalid_request" : "request_processing_failed",
      requestId: res.locals.x402RequestId ?? null,
    });
  };
  app.use(errors);
  return app;
}
