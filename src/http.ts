import express, {
  type ErrorRequestHandler,
  type Request,
} from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server.js";
import { loadTools, findProjectFile } from "./load-tools.js";
import { loadCatalog } from "./catalog.js";
import { dispatchTool } from "./dispatch.js";
import { createX402PricingRouter, PRICING_ROUTE } from "./x402-routes.js";
import { pricingWorkerFromEnvironment } from "./pricing-worker.js";
import { createWebToJsonRouter } from "./web-to-json-router.js";
import { loadOptionalMcpAuth, type McpAuth } from "./mcp-auth.js";
import {
  createBuyerBoundDispatcher,
  createDeliveryGuardDispatcher,
  type DeliveryOperation,
} from "./buyer-bound-dispatch.js";

const app = express();
app.disable("x-powered-by");

// Runtime MCP buyer authentication. Enabled only when the full MCP_AUTH_*
// configuration is present; partial configuration fails startup. While
// unconfigured, /mcp keeps its current behavior and delivery tool names are
// still blocked by the guard dispatcher and absent from the manifest.
const mcpAuth: McpAuth | undefined = loadOptionalMcpAuth();

if (mcpAuth) {
  app.get("/.well-known/oauth-protected-resource", mcpAuth.metadata);
  app.use("/mcp", mcpAuth.requireBuyer);
}

// Prepaid delivery owns its JSON parser and must precede the global parser.
// Base44 remains the sole entitlement, balance, job, and result authority.
app.use(createWebToJsonRouter());

// Enforce the smaller pricing-body limit before the existing global parser.
app.post(PRICING_ROUTE, express.json({ limit: "8kb", strict: true }));
app.use(express.json());

const tools = loadTools();
const catalog = loadCatalog();

// PROVISIONAL permission names pending the reviewed authorization-server
// contract. Delivery cannot execute while deliveryEnabled is false, so these
// values are never enforced in production until that contract is confirmed.
const DELIVERY_PERMISSIONS: Readonly<
  Record<DeliveryOperation, readonly string[]>
> = Object.freeze({
  balance: Object.freeze(["web-to-json:read"]),
  extract: Object.freeze(["web-to-json:use"]),
  job: Object.freeze(["web-to-json:read"]),
});

function createRequestDispatcher(
  auth: McpAuth | undefined,
  req: Request,
): (name: string, args: Record<string, unknown>) => Promise<unknown> {
  // Delivery stays default-off: no enable flag and no session adapter is
  // wired yet, so no delivery call can reach Base44 through this path.
  return auth
    ? createBuyerBoundDispatcher(auth.principalFor(req), {
        expectedAudience: auth.resource,
        deliveryEnabled: () => false,
        requiredScopes: DELIVERY_PERMISSIONS,
        legacyDispatch: dispatchTool,
      })
    : createDeliveryGuardDispatcher(dispatchTool);
}

app.get("/.well-known/agent-card.json", (_req, res) => {
  res.type("application/json");
  res.send(findProjectFile("well-known/agent-card.json"));
});

app.get("/api/v1/catalog.json", (_req, res) => {
  res.type("application/json");
  res.send(JSON.stringify(catalog));
});

app.post("/mcp", async (req, res) => {
  try {
    const server = createServer(tools, createRequestDispatcher(mcpAuth, req));
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch {
    // Stable public error; never echo exception text or request content.
    res.status(500).json({
      jsonrpc: "2.0",
      error: { code: -32603, message: "request_processing_failed" },
    });
  }
});

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, tools: tools.length, offers: catalog.offers.length });
});

// Keep existing routes ahead of the payment middleware. Never silently
// enable payment handling because credentials happen to exist.
const x402Enabled = process.env.X402_ENABLED === "true";
if (x402Enabled) {
  const worker = pricingWorkerFromEnvironment();
  if (!worker.ready()) {
    throw new Error("X402_ENABLED requires reviewed PRICING_APPROVED_URLS");
  }
  // Initialization errors deliberately fail startup rather than silently
  // serving an unprotected extraction route.
  app.use(await createX402PricingRouter(worker));
} else {
  app.post(PRICING_ROUTE, (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.status(503).json({ error: "x402_disabled" });
  });
}

const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  const status = (error as { status?: number } | null)?.status;
  const clientError = status === 400 || status === 413 || status === 415;
  // Never log URLs, request bodies, payment signatures, or credentials.
  console.error(
    JSON.stringify({
      event: "http_request_failed",
      requestId: res.locals.x402RequestId ?? null,
      errorType: error instanceof Error ? error.name : "Unknown",
    }),
  );
  res.setHeader("Cache-Control", "no-store");
  res.status(clientError ? status : 500).json({
    error: clientError ? "invalid_request" : "request_processing_failed",
    requestId: res.locals.x402RequestId ?? null,
  });
};
app.use(errorHandler);

const port = Number(process.env.PORT ?? 8080);
app.listen(port, () => {
  console.log(
    `codeximmortal-mcp http listening on ${port}; x402 enabled=${x402Enabled}; mcp auth=${Boolean(mcpAuth)}`,
  );
});
