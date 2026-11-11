import { describe, it, expect } from "vitest";
import { validateSnapshot } from "./pricing-snapshot.js";
const sample = () => ({ id: "s1", sourceUrl: "https://example.test/pricing", capturedAt: "2026-11-11T15:00:00.000Z", coverage: "partial", plans: [{ id: "basic", name: "Basic", amount: 99, currency: "USD", interval: "month", evidence: { text: "$99 per month", token: "99" } }] });
describe("synthetic snapshot validation", () => {
  it("accepts consistent payload", () => expect(validateSnapshot(sample()).plans[0].amount).toBe(99));
  it("rejects unknown fields", () => expect(() => validateSnapshot({ ...sample(), buyerId: "other" })).toThrow("invalid_fields"));
  it("rejects numeric substring evidence", () => { const v = sample(); v.plans[0].evidence.text = "$199"; expect(() => validateSnapshot(v)).toThrow(); });
  it("rejects decimal substring evidence", () => { const v = sample(); v.plans[0].evidence.text = "$99.5"; expect(() => validateSnapshot(v)).toThrow(); });
  it("rejects duplicate plans", () => { const v = sample(); v.plans.push(v.plans[0]); expect(() => validateSnapshot(v)).toThrow("duplicate_plan_id"); });
  it("rejects empty complete snapshots", () => expect(() => validateSnapshot({ ...sample(), coverage: "complete", plans: [] })).toThrow("invalid_plans"));
  it("rejects invalid URL schemes", () => expect(() => validateSnapshot({ ...sample(), sourceUrl: "file:///etc/passwd" })).toThrow("invalid_source_url"));
});
