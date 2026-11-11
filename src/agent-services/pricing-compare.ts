import { type Comparison } from "./contracts.js";
import { validateSnapshot } from "./pricing-snapshot.js";
// Supply trust metadata only from a future authorized, buyer-bound backend adapter.
// This pure function does not establish ownership or producer trust.
export interface SnapshotTrust {
  beforeCompleteTrusted: boolean;
  afterCompleteTrusted: boolean;
}
export function compareSnapshots(beforeValue: unknown, afterValue: unknown, trust: SnapshotTrust): Comparison[] {
  const before = validateSnapshot(beforeValue), after = validateSnapshot(afterValue);
  if (before.sourceUrl !== after.sourceUrl) throw new Error("source_mismatch");
  if (Date.parse(after.capturedAt) < Date.parse(before.capturedAt)) throw new Error("snapshot_order_invalid");
  const oldPlans = new Map(before.plans.map(p => [p.id, p]));
  const newPlans = new Map(after.plans.map(p => [p.id, p]));
  const changes: Comparison[] = [];
  for (const id of [...new Set([...oldPlans.keys(), ...newPlans.keys()])].sort()) {
    const old = oldPlans.get(id) ?? null, current = newPlans.get(id) ?? null;
    const emit = (kind: Comparison["kind"]) => changes.push({ planId: id, kind, before: old, after: current });
    if (!current) { emit(after.coverage === "complete" && after.plans.length > 0 && trust.afterCompleteTrusted === true ? "plan_removed" : "plan_not_observed"); continue; }
    if (!old) {
      // Absence in a partial earlier snapshot does not prove the plan is new.
      emit(before.coverage === "complete" && before.plans.length > 0 && trust.beforeCompleteTrusted === true ? "plan_added" : "plan_first_observed");
      if (current.amount === null) emit("price_unavailable");
      continue;
    }
    if (old.currency !== current.currency || old.interval !== current.interval || old.name !== current.name) emit("terms_changed");
    if (old.amount === null || current.amount === null) emit("price_unavailable");
    else if (old.currency === current.currency && old.interval === current.interval && old.amount !== current.amount) emit("price_changed");
  }
  return changes;
}
