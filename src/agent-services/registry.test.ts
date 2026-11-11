import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { proposedServices, assertPublicationAllowed } from "./registry.js";
describe("synthetic planned registry", () => {
  it("keeps all three services unpriced and uncertified", () => {
    expect(proposedServices).toHaveLength(3);
    for (const service of proposedServices) { expect(service.status).toBe("planned"); expect(service.certification).toBe("UNCERTIFIED"); expect(service.price).toBeNull(); expect(service.registered).toBe(false); }
  });
  it("refuses publication locally", () => expect(assertPublicationAllowed).toThrow("service_publication_disabled"));
  it("does not advertise proposed tool identifiers in the existing manifest", () => {
    const manifest = readFileSync(new URL("../../mcp-manifest.json", import.meta.url), "utf8");
    JSON.parse(manifest);
    for (const service of proposedServices) expect(manifest).not.toContain(service.tool);
  });
});
