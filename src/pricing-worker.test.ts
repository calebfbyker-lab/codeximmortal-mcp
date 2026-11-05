import { describe, expect, it } from "vitest";
import { isPublicIPv4, parsePricingHtml } from "./pricing-worker.js";

const jsonLdPage = (data: unknown): string =>
  `<html><head><script type="application/ld+json">${JSON.stringify(data)}</script></head></html>`;

describe("isPublicIPv4", () => {
  it("rejects private, loopback, link-local, and reserved ranges", () => {
    for (const address of [
      "0.0.0.0", "10.0.0.1", "127.0.0.1", "169.254.1.1",
      "172.16.0.1", "172.31.255.1", "192.168.1.1", "192.0.2.1",
      "198.18.0.1", "100.64.0.1",
    ]) {
      expect(isPublicIPv4(address), address).toBe(false);
    }
  });
  it("accepts ordinary public addresses", () => {
    for (const address of ["1.1.1.1", "8.8.8.8", "104.18.0.1"]) {
      expect(isPublicIPv4(address), address).toBe(true);
    }
  });
  it("rejects non-IPv4 inputs", () => {
    expect(isPublicIPv4("::1")).toBe(false);
    expect(isPublicIPv4("example.com")).toBe(false);
    expect(isPublicIPv4("")).toBe(false);
  });
});

describe("parsePricingHtml", () => {
  it("extracts Product offers with price and currency", () => {
    const html = jsonLdPage({
      "@type": "Product",
      name: "Example plan",
      offers: { "@type": "Offer", price: "29.00", priceCurrency: "USD" },
    });
    const result = parsePricingHtml(html, "https://example.com/pricing");
    expect(result.sourceUrl).toBe("https://example.com/pricing");
    expect(result.plans).toHaveLength(1);
    expect(result.plans[0]).toMatchObject({
      name: "Example plan",
      displayedAmount: "29.00",
      currency: "USD",
      billingInterval: null,
    });
    expect(result.plans[0].sourceExcerpt).toContain("\"@type\":\"Offer\"");
  });
  it("supports typed IRIs and @graph containers", () => {
    const html = jsonLdPage({
      "@graph": [{
        "@type": "https://schema.org/Product",
        name: "Pro",
        offers: [{ "@type": "http://schema.org/Offer", price: 99, priceCurrency: "EUR" }],
      }],
    });
    const result = parsePricingHtml(html, "https://example.com/pricing");
    expect(result.plans).toHaveLength(1);
    expect(result.plans[0]).toMatchObject({
      name: "Pro",
      displayedAmount: "99",
      currency: "EUR",
    });
  });
  it("extracts top-level Offer objects without a Product wrapper", () => {
    const html = jsonLdPage({ "@type": "Offer", name: "Direct", price: "3", priceCurrency: "USD" });
    const result = parsePricingHtml(html, "u");
    expect(result.plans).toHaveLength(1);
    expect(result.plans[0].name).toBe("Direct");
  });
  it("deduplicates identical plans", () => {
    const offer = { "@type": "Offer", price: "10", priceCurrency: "USD" };
    const html = jsonLdPage([
      { "@type": "Product", name: "Team", offers: offer },
      { "@type": "Product", name: "Team", offers: offer },
    ]);
    expect(parsePricingHtml(html, "u").plans).toHaveLength(1);
  });
  it("leaves currency null when absent", () => {
    const html = jsonLdPage({ "@type": "Product", name: "P", offers: { "@type": "Offer", price: "7" } });
    expect(parsePricingHtml(html, "u").plans[0].currency).toBeNull();
  });
  it("rejects non-numeric prices", () => {
    const html = jsonLdPage({ "@type": "Product", name: "P", offers: { "@type": "Offer", price: "free", priceCurrency: "USD" } });
    expect(() => parsePricingHtml(html, "u")).toThrow(/No supported structured pricing offers found/);
  });
  it("rejects pages without structured offers", () => {
    const html = jsonLdPage({ "@type": "Product", name: "No offer price" });
    expect(() => parsePricingHtml(html, "u")).toThrow(/No supported structured pricing offers found/);
  });
  it("skips malformed JSON-LD blocks but parses valid ones", () => {
    const html =
      "<html>" +
      '<script type="application/ld+json">{invalid json</script>' +
      '<script type="application/ld+json">' +
      JSON.stringify({ "@type": "Product", name: "OK", offers: { "@type": "Offer", price: "5", priceCurrency: "USD" } }) +
      "</script></html>";
    const result = parsePricingHtml(html, "u");
    expect(result.plans).toHaveLength(1);
    expect(result.plans[0].name).toBe("OK");
  });
  it("ignores non-JSON-LD scripts", () => {
    const html =
      "<html>" +
      "<script>var x = { '\u0040type': 'Offer' };</script>" +
      '<script type="application/ld+json">' +
      JSON.stringify({ "@type": "Offer", name: "Direct", price: "3", priceCurrency: "USD" }) +
      "</script></html>";
    const result = parsePricingHtml(html, "u");
    expect(result.plans).toHaveLength(1);
    expect(result.plans[0].name).toBe("Direct");
  });
});
