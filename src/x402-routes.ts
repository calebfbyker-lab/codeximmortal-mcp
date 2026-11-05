import { Router, type RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { createCdpFacilitatorClient } from "@coinbase/cdp-sdk/x402";
import { paymentMiddleware } from "@x402/express";
import { x402ResourceServer } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import {
  declareDiscoveryExtension,
  bazaarResourceServerExtension,
} from "@x402/extensions";

export const PRICING_ROUTE = "/v1/pricing-extractions";

export interface PricingResult {
  sourceUrl: string;
  extractedAt: string;
  plans: Array<{
    name: string;
    displayedAmount: string | null;
    currency: string | null;
    billingInterval: string | null;
    sourceExcerpt: string;
  }>;
}

export interface PricingWorker {
  // These checks must be synchronous and must not fetch remote content.
  ready(): boolean;
  supports(url: URL): boolean;
  // Implement DNS/IP and redirect restrictions, byte/time limits, runtime
  // output validation, and cancellation inside the worker. HTTPS alone
  // is not SSRF protection. Do not expose an arbitrary-URL fetcher.
  extract(url: string, options: {
    requestId: string;
    signal: AbortSignal;
  }): Promise<PricingResult>;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

// Mount at the application root AFTER express.json({ limit: "8kb" }).
// No listener, wallet provisioning, or application mutation occurs on import.
// This module is a testnet integration scaffold, not production order recovery.
export async function createX402PricingRouter(worker: PricingWorker) {
  const environment = process.env.X402_ENVIRONMENT ?? "development";
  if (environment !== "development" && environment !== "production") {
    throw new Error("X402_ENVIRONMENT must be development or production");
  }
  if (environment === "production" &&
      process.env.X402_MAINNET_APPROVED !== "true") {
    throw new Error("Mainnet configuration requires operator approval");
  }
  required("CDP_API_KEY_ID");
  required("CDP_API_KEY_SECRET");
  const payTo = required("X402_PAY_TO");
  if (!/^0x[0-9a-fA-F]{40}$/.test(payTo) || /^0x0{40}$/i.test(payTo)) {
    throw new Error("X402_PAY_TO must be a nonzero EVM address");
  }
  const price = required("X402_PRICE");
  if (!/^\$\d+\.\d{2}$/.test(price) ||
      BigInt(price.slice(1).replace(".", "")) <= 0n) {
    throw new Error("X402_PRICE must be positive, for example $0.05");
  }
  const network = environment === "production"
    ? "eip155:8453" as const : "eip155:84532" as const;

  // Coinbase's documented drop-in facilitator integration: the resource
  // server, payment scheme, and middleware all come from the standalone
  // @x402 packages. Only the facilitator client object crosses from
  // @coinbase/cdp-sdk, and it satisfies @x402/core's facilitator interface
  // structurally. No cdp-sdk class identity is assigned to an @x402/express
  // parameter, so the nominal-type mismatch that failed previous builds
  // cannot occur on this path.
  const facilitator = createCdpFacilitatorClient();
  const server = new x402ResourceServer(facilitator)
    .register(network, new ExactEvmScheme())
    // Bazaar discovery: without this extension the endpoint is payable
    // but invisible to Bazaar search and never indexed.
    .registerExtension(bazaarResourceServerExtension);

  // Example shown to buyer agents in Bazaar listings. Must be a URL the
  // worker actually supports; PRICING_EXAMPLE_URL should match one entry of
  // PRICING_APPROVED_URLS.
  const exampleUrl = process.env.PRICING_EXAMPLE_URL ??
    "https://example.com/pricing";

  const router = Router({ caseSensitive: true, strict: true });
  const validate: RequestHandler = (req, res, next) => {
    try {
      const requestId = randomUUID();
      res.locals.x402RequestId = requestId;
      res.setHeader("X-Request-ID", requestId);
      res.setHeader("Cache-Control", "no-store");
      if (!req.is("application/json")) {
        res.status(415).json({ error: "application_json_required", requestId });
        return;
      }
      const body: unknown = req.body;
      if (typeof body !== "object" || body === null || Array.isArray(body) ||
          Object.keys(body).length !== 1 || !("url" in body) ||
          typeof body.url !== "string" || body.url.length > 2048) {
        res.status(400).json({ error: "invalid_body", requestId });
        return;
      }
      let url: URL;
      try { url = new URL(body.url); }
      catch {
        res.status(400).json({ error: "invalid_url", requestId });
        return;
      }
      if (url.protocol !== "https:" || url.username || url.password ||
          url.hash || (url.port && url.port !== "443")) {
        res.status(400).json({ error: "unsupported_url", requestId });
        return;
      }
      if (!worker.ready()) {
        res.status(503).json({ error: "worker_unavailable", requestId });
        return;
      }
      if (!worker.supports(url)) {
        res.status(422).json({ error: "unsupported_page", requestId });
        return;
      }
      res.locals.x402InputUrl = url.href;
      next();
    } catch (error) { next(error); }
  };

  // Validation and capability checks precede the payment middleware.
  router.post(PRICING_ROUTE, validate);
  router.use(paymentMiddleware({
    [`POST ${PRICING_ROUTE}`]: {
      accepts: [{
        scheme: "exact",
        price,
        network,
        payTo: payTo as `0x${string}`,
      }],
      description:
        "Extract software pricing-plan names, displayed amounts, " +
        "currencies, billing intervals, and evidence excerpts from supported " +
        "public HTTPS pages. Unknown values are null. Static pages only; " +
        "no monitoring or effective-price calculation.",
      extensions: declareDiscoveryExtension({
        method: "POST",
        bodyType: "json",
        input: { url: exampleUrl },
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["url"],
          properties: {
            url: {
              type: "string",
              format: "uri",
              maxLength: 2048,
              description:
                "Supported public HTTPS software pricing-page URL. " +
                "No credentials, login-protected pages, or private-network URLs.",
            },
          },
        },
        output: {
          example: {
            requestId: "example-request-id",
            sourceUrl: exampleUrl,
            extractedAt: "2026-11-05T00:00:00Z",
            plans: [
              {
                name: "Example plan",
                displayedAmount: "29",
                currency: "USD",
                billingInterval: null,
                sourceExcerpt: "Example plan — USD 29 per month",
              },
            ],
          },
        },
      }),
    },
  }, server));
  router.post(PRICING_ROUTE, async (_req, res, next) => {
    try {
      const requestId = res.locals.x402RequestId as string;
      const result = await worker.extract(res.locals.x402InputUrl as string, {
        requestId,
        signal: AbortSignal.timeout(20_000),
      });
      res.status(200).json({ ...result, requestId });
    } catch (error) {
      // Delegate sanitized responses to the application's error handler.
      // No automatic refund, settlement reconciliation, or retry guarantee.
      next(error);
    }
  });
  return router;
}
