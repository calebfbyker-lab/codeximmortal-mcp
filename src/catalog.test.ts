import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const catalog = JSON.parse(readFileSync("catalog.json", "utf8"));
const webToJsonSku = "web-to-json-50";

describe("catalog", () => {
  it("has 12 storefront offers with valid one-time checkout options", () => {
    expect(Array.isArray(catalog.offers)).toBe(true);
    expect(catalog.offers).toHaveLength(12);
    const offerIds = new Set<string>();
    const productIds = new Set<string>();
    const priceIds = new Set<string>();
    for (const offer of catalog.offers) {
      expect(typeof offer.offer_id).toBe("string");
      expect(offer.offer_id).toMatch(/^offer-[a-z0-9-]+$/);
      expect(offerIds.has(offer.offer_id)).toBe(false);
      offerIds.add(offer.offer_id);
      expect(typeof offer.product_id).toBe("string");
      expect(offer.product_id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(productIds.has(offer.product_id)).toBe(false);
      productIds.add(offer.product_id);
      const productRoute = offer.product_id === webToJsonSku ? "web-to-json" : offer.product_id;
      expect(offer.checkout_url).toBe(`https://codeximmortal.com/products/${productRoute}`);
      expect(offer.pricing.basis).toBe("one-time");
      expect(offer.pricing.currency).toBe("USD");
      expect(Number.isSafeInteger(offer.pricing.amount_minor)).toBe(true);
      expect(offer.pricing.amount_minor).toBeGreaterThan(0);
      expect(Array.isArray(offer.pricing.options)).toBe(true);
      expect(offer.pricing.options.length).toBeGreaterThan(0);
      for (const option of offer.pricing.options) {
        if (offer.product_id === webToJsonSku) {
          expect(option.price_source).toBe("server_inline_price_data");
          expect(option).not.toHaveProperty("price_id");
        } else {
          expect(typeof option.price_id).toBe("string");
          expect(option.price_id).toMatch(/^price_[A-Za-z0-9]+$/);
          expect(priceIds.has(option.price_id)).toBe(false);
          priceIds.add(option.price_id);
        }
        expect(option.type).toBe("one_time");
        expect(option.currency).toBe(offer.pricing.currency);
        expect(Number.isSafeInteger(option.amount_minor)).toBe(true);
        expect(option.amount_minor).toBeGreaterThan(0);
        expect(option.amount_minor).toBe(offer.pricing.amount_minor);
      }
    }
  });

  it("describes the sourced Web-to-JSON bundle without claiming Render execution", () => {
    const offer = catalog.offers.find((item: { product_id: string }) => item.product_id === webToJsonSku);
    expect(offer).toBeDefined();
    expect(offer.offer_id).toBe("offer-web-to-json-50");
    expect(offer.pricing.amount_minor).toBe(1000);
    expect(offer.pricing.options).toHaveLength(1);
    expect(offer.capacity).toEqual({ units: 50, unit: "supported page extraction" });
    expect(offer.checkout).toEqual({
      model: "human_authorized_hosted_checkout", method: "POST",
      endpoint: "https://codex-immortal-2c799423.base44.app/functions/web_to_json_checkout",
      required_body_fields: ["email"], commercial_values: "server_owned",
      machine_purchase: false, automatic_replenishment: false,
    });
    expect(offer.delivery.render_execution).toBe("not_connected");
    expect(offer.delivery.mcp_execution).toBe("not_connected");
    expect(offer.delivery.end_to_end_validation).toBe("pending");
    expect(offer.validation_status).toBe("UNCERTIFIED");
  });

  it("declares test-mode payment posture (fail closed)", () => {
    expect(catalog.payment.mode).toBe("test");
    expect(catalog.payment.live_payouts).toBe("disabled");
  });
});
