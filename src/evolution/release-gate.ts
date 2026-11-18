// Release-evidence contract. Deterministic evaluation of recorded evidence
// records; no test execution, network access or deployment occurs here.
export type GateName =
  | "build" | "unit_tests" | "db_regression" | "remote_ci" | "provider_snapshot"
  | "funding_events" | "external_client_flow" | "receipts" | "crash_recovery"
  | "deployment" | "prices_approved" | "publication" | "owner_approval";
export interface EvidenceRecord {
  gate: GateName;
  commit: string;               // 40-char hex of the exact tested commit
  observedAt: string;           // ISO 8601
  command?: string;             // invocation that produced the result
  result: "pass" | "fail" | "unknown";
  skipped?: boolean;            // must be false for a pass to count
  notes?: string;               // environment, limitations; never credentials
}
const GATES: Record<string, string[]> = {
  // service publication requires every gate in this list
  publish_services: ["build", "unit_tests", "db_regression", "remote_ci",
    "provider_snapshot", "funding_events", "external_client_flow", "receipts",
    "crash_recovery", "deployment", "prices_approved", "owner_approval"],
};
export function validateEvidenceRecord(value: unknown): EvidenceRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("invalid_record");
  const v = value as Record<string, unknown>;
  const gate = typeof v.gate === "string" ? v.gate : "";
  if (!/^[a-z_]+$/.test(gate)) throw new Error("invalid_gate");
  if (typeof v.commit !== "string" || !/^[0-9a-f]{40}$/.test(v.commit)) throw new Error("invalid_commit");
  if (typeof v.observedAt !== "string" || Number.isNaN(Date.parse(v.observedAt))) throw new Error("invalid_timestamp");
  if (v.result !== "pass" && v.result !== "fail" && v.result !== "unknown") throw new Error("invalid_result");
  if (v.command !== undefined && (typeof v.command !== "string" || v.command.length > 512)) throw new Error("invalid_command");
  if (v.skipped !== undefined && typeof v.skipped !== "boolean") throw new Error("invalid_skip_flag");
  if (v.notes !== undefined && (typeof v.notes !== "string" || v.notes.length > 2000)) throw new Error("invalid_notes");
  return { gate: gate as GateName, commit: v.commit, observedAt: v.observedAt,
    command: v.command as string | undefined, result: v.result as "pass" | "fail" | "unknown",
    skipped: (v.skipped as boolean | undefined) ?? false, notes: v.notes as string | undefined };
}
export function evaluatePublication(records: readonly unknown[], commit: string) {
  if (typeof commit !== "string" || !/^[0-9a-f]{40}$/.test(commit)) throw new Error("invalid_commit");
  const validated = records.map(validateEvidenceRecord);
  const passing = new Set<string>();
  for (const r of validated) {
    // Stale-commit evidence, skipped runs and failures never satisfy a gate.
    if (r.commit === commit && r.result === "pass" && !r.skipped) passing.add(r.gate);
  }
  const required = GATES.publish_services;
  const missing = required.filter(gate => !passing.has(gate));
  return { publishable: missing.length === 0, missing, satisfied: required.filter(gate => passing.has(gate)) };
}
