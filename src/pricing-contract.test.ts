import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { normalizePricing } from "./pricing-contract.js";
import { dryRunPricing } from "./pricing-dry-run.js";
import { createPricingWorker, parsePricingHtml } from "./pricing-worker.js";
import type { PricingWorker } from "./x402-routes.js";

const url = "https://example.com/pricing";
const evidence = '{ "@type": "Product", "name": "Pro", "offers": { "@type": "Offer", "price": "29.00", "priceCurrency": "USD" } }';
const html = `<script type="application/ld+json">${evidence}</script>`;

function fixtureWorker(page = html): PricingWorker {
  return {
    ready: () => true,
    supports: candidate => candidate.href === url,
    extract: async source => parsePricingHtml(page, source),
  };
}

describe("draft pricing contract", () => {
  it("maps fields and preserves exact evidence", () => {
    const parsed = parsePricingHtml(html, url);
    expect(normalizePricing(parsed)).toEqual({
      contract_version: "pricing-extraction.draft-1",
      source_url: url, retrieved_at: parsed.extractedAt,
      extraction_method: "json_ld",
      plans: [{
        name: "Pro", price: "29.00", currency: "USD",
        price_basis: null, billing_interval: null,
        billing_commitment: null, minimum_seats: null,
        usage_allowance: null, evidence,
      }],
    });
  });

  it("preserves unknown values and decimal precision", () => {
    const result = normalizePricing({
      sourceUrl: url, extractedAt: "2026-11-07T00:00:00Z",
      plans: [
        { name: "Unknown", displayedAmount: null, currency: null,
          billingInterval: null, sourceExcerpt: "original evidence" },
        { name: "Exact", displayedAmount: "9007199254740993.01", currency: "USD",
          billingInterval: null, sourceExcerpt: "original evidence" },
      ],
    });
    expect(result.plans[0].price).toBeNull();
    expect(result.plans[0].currency).toBeNull();
    expect(result.plans[1].price).toBe("9007199254740993.01");
    expect(result).not.toHaveProperty("charged_units");
    expect(result).not.toHaveProperty("job_id");
  });
});

describe("local dry run", () => {
  it("invokes the worker directly without accounting metadata", async () => {
    const worker = fixtureWorker();
    const extract = vi.spyOn(worker, "extract");
    const output = await dryRunPricing(url, worker);
    expect(extract).toHaveBeenCalledTimes(1);
    expect(extract).toHaveBeenCalledWith(url, {
      requestId: expect.any(String), signal: expect.any(AbortSignal),
    });
    expect(output.mode).toBe("local_dry_run");
    expect(output.billing).toBe("not_invoked");
    expect(output.result.plans[0].evidence).toBe(evidence);
  });

  it("fails closed on an empty real allowlist", async () => {
    await expect(dryRunPricing(url, createPricingWorker([])))
      .rejects.toThrow("Worker not configured");
  });

  it("rejects an unapproved destination using the real worker", async () => {
    await expect(dryRunPricing("https://example.net/pricing", createPricingWorker([url])))
      .rejects.toThrow("URL not approved");
  });

  it("rejects unsupported visible-only content", async () => {
    await expect(dryRunPricing(url, fixtureWorker("<h1>Pro: USD 29 monthly</h1>")))
      .rejects.toThrow("No supported structured pricing offers found");
  });

  it("does not extract when capability checks fail", async () => {
    const worker = fixtureWorker();
    worker.supports = () => false;
    const extract = vi.spyOn(worker, "extract");
    await expect(dryRunPricing(url, worker)).rejects.toThrow("URL not approved");
    expect(extract).not.toHaveBeenCalled();
  });

  it("keeps billing and server modules out of the runtime import graph", () => {
    const root = dirname(fileURLToPath(import.meta.url));
    const allowedLocal = new Set([
      "pricing-dry-run-cli.ts", "pricing-dry-run.ts",
      "pricing-worker.ts", "pricing-contract.ts",
    ].map(name => resolve(root, name)));
    const allowedExternal = new Set([
      "node:crypto", "node:dns/promises", "node:net", "node:https", "node:tls",
    ]);
    const visited = new Set<string>();
    function visit(path: string): void {
      if (visited.has(path)) return;
      expect(allowedLocal.has(path), path).toBe(true);
      visited.add(path);
      const source = ts.createSourceFile(path, readFileSync(path, "utf8"),
        ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      function walk(node: ts.Node): void {
        if (ts.isImportDeclaration(node)) {
          const clause = node.importClause;
          const typeOnly = clause?.isTypeOnly ||
            (!clause?.name && clause?.namedBindings &&
             ts.isNamedImports(clause.namedBindings) &&
             clause.namedBindings.elements.length > 0 &&
             clause.namedBindings.elements.every(element => element.isTypeOnly));
          if (!typeOnly) {
            expect(ts.isStringLiteral(node.moduleSpecifier)).toBe(true);
            const specifier = (node.moduleSpecifier as ts.StringLiteral).text;
            if (specifier.startsWith(".")) {
              visit(resolve(dirname(path), specifier.replace(/\.js$/, ".ts")));
            } else {
              expect(allowedExternal.has(specifier), specifier).toBe(true);
            }
          }
        }
        if (ts.isExportDeclaration(node) && node.moduleSpecifier && !node.isTypeOnly) {
          throw new Error("Runtime re-exports require dependency review");
        }
        if (ts.isCallExpression(node)) {
          expect(node.expression.kind === ts.SyntaxKind.ImportKeyword).toBe(false);
          if (ts.isIdentifier(node.expression)) {
            expect(["require", "eval", "Function"].includes(node.expression.text)).toBe(false);
          }
        }
        if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
          expect(node.expression.text).not.toBe("Function");
        }
        ts.forEachChild(node, walk);
      }
      walk(source);
    }
    visit(resolve(root, "pricing-dry-run-cli.ts"));
    expect(visited.size).toBe(4);
  });
});
