import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const catalog = JSON.parse(readFileSync("catalog.json", "utf8"));

describe("catalog", () => {
  it("has 11 Stripe-sourced offers with valid price options", () => {
    expect(catalog.offers).toHaveLength(11);
    for (const offer of catalog.offers) {
      expect(offer.offer_id).toMatch(/^offer-[a-z0-9-]+$/);
      expect(offer.product_id).toMatch(/^prod_/);
      expect(offer.pricing.options.length).toBeGreaterThan(0);
      for (const opt of offer.pricing.options) {
        expect(opt.price_id).toMatch(/^price_/);
        expect(opt.amount_minor).toBeGreaterThan(0);
      }
    }
  });

  it("declares test-mode payment posture (fail closed)", () => {
    expect(catalog.payment.mode).toBe("test");
    expect(catalog.payment.live_payouts).toBe("disabled");
  });
});
