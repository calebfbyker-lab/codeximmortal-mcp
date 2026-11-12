import { createHttpApp } from "./http-app.js";
import { loadTools, findProjectFile } from "./load-tools.js";
import { loadCatalog } from "./catalog.js";
import { dispatchTool } from "./dispatch.js";
import { createX402PricingRouter, PRICING_ROUTE } from "./x402-routes.js";
import { pricingWorkerFromEnvironment } from "./pricing-worker.js";
import { createWebToJsonRouter } from "./web-to-json-router.js";
import { agentCommerceFromEnvironment } from "./agent-commerce/runtime.js";

const agentCommerce = agentCommerceFromEnvironment();
const x402Enabled = process.env.X402_ENABLED === "true";
let pricingRouter: Awaited<ReturnType<typeof createX402PricingRouter>> | undefined;
if (x402Enabled) {
  const worker = pricingWorkerFromEnvironment();
  if (!worker.ready()) throw new Error("X402_ENABLED requires reviewed PRICING_APPROVED_URLS");
  pricingRouter = await createX402PricingRouter(worker);
}
const app = createHttpApp({
  tools: loadTools(),
  catalog: loadCatalog(),
  agentCardJson: findProjectFile("well-known/agent-card.json"),
  commerce: agentCommerce.dependencies,
  dispatch: dispatchTool,
  storefrontRouter: createWebToJsonRouter(),
  pricingRoute: PRICING_ROUTE,
  pricingRouter,
});
const port = Number(process.env.PORT ?? 8080);
app.listen(port, () => {
  console.log(`codeximmortal-mcp http listening on ${port}; x402 enabled=${x402Enabled}`);
});
