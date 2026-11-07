import type { PricingResult } from "./x402-routes.js";

export interface PricingExtractionDraft {
  contract_version: "pricing-extraction.draft-1";
  source_url: string;
  retrieved_at: string;
  extraction_method: "json_ld";
  plans: Array<{
    name: string;
    price: string | null;
    currency: string | null;
    price_basis: null;
    billing_interval: string | null;
    billing_commitment: null;
    minimum_seats: null;
    usage_allowance: null;
    evidence: string;
  }>;
}

// Preserve decimal text; accounting metadata belongs to the application.
export function normalizePricing(result: PricingResult): PricingExtractionDraft {
  return {
    contract_version: "pricing-extraction.draft-1",
    source_url: result.sourceUrl,
    retrieved_at: result.extractedAt,
    extraction_method: "json_ld",
    plans: result.plans.map(plan => ({
      name: plan.name,
      price: plan.displayedAmount,
      currency: plan.currency,
      price_basis: null,
      billing_interval: plan.billingInterval,
      billing_commitment: null,
      minimum_seats: null,
      usage_allowance: null,
      evidence: plan.sourceExcerpt,
    })),
  };
}
