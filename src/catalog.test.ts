import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const catalog = JSON.parse(readFileSync("catalog.json", "utf8"));

describe("catalog", () => {
  it("has 11 storefront offers with valid one-time Stripe price options", () => {
    expect(Array.isArray(catalog.offers)).toBe(true);
    expect(catalog.offers).toHaveLength(11);

    const offerIds = new Set<string>();
    const productIds = new Set<string>();
    const priceIds = new Set<string>();

    for (const offer of catalog.offers) {
      // Offer identity.
      expect(typeof offer.offer_id).toBe("string");
      expect(offer.offer_id).toMatch(/^offer-[a-z0-9-]+$/);
      expect(offerIds.has(offer.offer_id)).toBe(false);
      offerIds.add(offer.offer_id);

      // product_id is a storefront SKU, not a Stripe prod_ identifier.
      expect(typeof offer.product_id).toBe("string");
      expect(offer.product_id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(productIds.has(offer.product_id)).toBe(false);
      productIds.add(offer.product_id);

      // Checkout must point to this product's canonical storefront page.
      expect(offer.checkout_url).toBe(
        `https://codeximmortal.com/products/${offer.product_id}`,
      );

      // Published pricing is one-time and denominated in USD minor units.
      expect(offer.pricing.basis).toBe("one-time");
      expect(offer.pricing.currency).toBe("USD");
      expect(Number.isSafeInteger(offer.pricing.amount_minor)).toBe(true);
      expect(offer.pricing.amount_minor).toBeGreaterThan(0);

      expect(Array.isArray(offer.pricing.options)).toBe(true);
      expect(offer.pricing.options.length).toBeGreaterThan(0);

      for (const option of offer.pricing.options) {
        // Payment options still require Stripe price identifiers.
        expect(typeof option.price_id).toBe("string");
        expect(option.price_id).toMatch(/^price_[A-Za-z0-9]+$/);
        expect(priceIds.has(option.price_id)).toBe(false);
        priceIds.add(option.price_id);

        expect(option.type).toBe("one_time");
        expect(option.currency).toBe(offer.pricing.currency);

        expect(Number.isSafeInteger(option.amount_minor)).toBe(true);
        expect(option.amount_minor).toBeGreaterThan(0);
        expect(option.amount_minor).toBe(offer.pricing.amount_minor);
      }
    }
  });

  it("declares test-mode payment posture (fail closed)", () => {
    expect(catalog.payment.mode).toBe("test");
    expect(catalog.payment.live_payouts).toBe("disabled");
  });
});
