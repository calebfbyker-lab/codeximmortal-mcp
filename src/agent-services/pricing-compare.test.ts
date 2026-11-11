import { describe, it, expect } from "vitest";
import { compareSnapshots } from "./pricing-compare.js";
const plan = (id: string, amount: number | null = 10) => ({ id, name: id, amount, currency: "USD", interval: "month", evidence: amount === null ? null : { text: String(amount), token: String(amount) } });
const snap = (plans: ReturnType<typeof plan>[], coverage = "partial") => ({ id: "s", sourceUrl: "https://example.test/pricing", capturedAt: "2026-11-11T15:00:00.000Z", coverage, plans });
describe("synthetic stored snapshot comparison", () => {
  it("reports unavailable price rather than removal", () => expect(compareSnapshots(snap([plan("a")]), snap([plan("a", null)]), { afterCompleteTrusted: false }).map(x => x.kind)).toEqual(["price_unavailable"]));
  it("does not remove partially observed plans", () => expect(compareSnapshots(snap([plan("a")]), snap([]), { afterCompleteTrusted: true })[0].kind).toBe("plan_not_observed"));
  it("requires trusted complete coverage", () => expect(compareSnapshots(snap([plan("a")]), snap([plan("b")], "complete"), { afterCompleteTrusted: false })[0].kind).toBe("plan_not_observed"));
  it("permits removal with trusted nonempty complete coverage", () => expect(compareSnapshots(snap([plan("a")]), snap([plan("b")], "complete"), { afterCompleteTrusted: true })[0].kind).toBe("plan_removed"));
  it("detects comparable price change", () => expect(compareSnapshots(snap([plan("a")]), snap([plan("a", 20)]), { afterCompleteTrusted: false })[0].kind).toBe("price_changed"));
  it("rejects cross-source comparison", () => expect(() => compareSnapshots(snap([]), { ...snap([]), sourceUrl: "https://other.test/" }, { afterCompleteTrusted: false })).toThrow("source_mismatch"));
});
