import { describe, expect, it } from "vitest";
import { evaluatePublication, validateEvidenceRecord } from "./release-gate.js";
const COMMIT = "9460f9a0a7392bc755dae99672ad5493e90dba5a";
function record(gate: string, over: Record<string, unknown> = {}) {
  return { gate, commit: COMMIT, observedAt: "2026-11-12T22:24:16.000Z",
    result: "pass", ...over };
}
describe("release-evidence contract", () => {
  it("rejects malformed records", () => {
    expect(() => validateEvidenceRecord(null)).toThrow("invalid_record");
    expect(() => validateEvidenceRecord(record("build", { commit: "short" }))).toThrow("invalid_commit");
    expect(() => validateEvidenceRecord(record("build", { result: "maybe" }))).toThrow("invalid_result");
    expect(() => validateEvidenceRecord(record("build", { observedAt: "yesterday" }))).toThrow("invalid_timestamp");
  });
  it("blocks publication while required gates are unmet", () => {
    const outcome = evaluatePublication([record("build"), record("unit_tests")], COMMIT);
    expect(outcome.publishable).toBe(false);
    expect(outcome.missing).toContain("provider_snapshot");
    expect(outcome.missing).not.toContain("build");
  });
  it("never accepts stale, skipped or failing evidence as a pass", () => {
    const stale = record("build", { commit: "0".repeat(40) });
    const skipped = record("unit_tests", { skipped: true });
    const failed = record("db_regression", { result: "fail" });
    const outcome = evaluatePublication([stale, skipped, failed, record("prices_approved", { result: "unknown" })], COMMIT);
    expect(outcome.satisfied).toEqual([]);
    expect(outcome.missing).toContain("build");
    expect(outcome.missing).toContain("unit_tests");
    expect(outcome.missing).toContain("db_regression");
  });
  it("requires publication approval gates together", () => {
    const required = ["build","unit_tests","db_regression","remote_ci","provider_snapshot",
      "funding_events","external_client_flow","receipts","crash_recovery","deployment",
      "prices_approved","owner_approval"];
    const all = required.map(gate => record(gate));
    const outcome = evaluatePublication(all, COMMIT);
    expect(outcome.publishable).toBe(true);
    expect(outcome.missing).toEqual([]);
    expect(evaluatePublication(all.slice(0, -1), COMMIT).publishable).toBe(false);
  });
});
