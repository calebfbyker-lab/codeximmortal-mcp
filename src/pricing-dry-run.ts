import { randomUUID } from "node:crypto";
import { pricingWorkerFromEnvironment } from "./pricing-worker.js";
import { normalizePricing } from "./pricing-contract.js";
import type { PricingWorker } from "./x402-routes.js";

export async function dryRunPricing(
  raw: string,
  worker: PricingWorker = pricingWorkerFromEnvironment(),
) {
  const url = new URL(raw);
  if (!worker.ready()) throw new Error("Worker not configured");
  if (!worker.supports(url)) throw new Error("URL not approved");
  const result = await worker.extract(url.href, {
    requestId: randomUUID(),
    signal: AbortSignal.timeout(20_000),
  });
  return {
    mode: "local_dry_run" as const,
    billing: "not_invoked" as const,
    result: normalizePricing(result),
  };
}
