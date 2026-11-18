import { identifier, object, text, type Plan, type Snapshot } from "./contracts.js";
import { validateAmountEvidence } from "./evidence.js";
export function validateSnapshot(value: unknown): Snapshot {
  const v = object(value, ["id", "sourceUrl", "capturedAt", "coverage", "plans"]);
  const id = identifier(v.id), sourceUrl = text(v.sourceUrl, 2048), capturedAt = text(v.capturedAt, 40);
  let url: URL;
  try { url = new URL(sourceUrl); } catch { throw new Error("invalid_source_url"); }
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("invalid_source_url");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(capturedAt) || !Number.isFinite(Date.parse(capturedAt)) || new Date(capturedAt).toISOString() !== capturedAt) throw new Error("invalid_timestamp");
  if (v.coverage !== "partial" && v.coverage !== "complete") throw new Error("invalid_coverage");
  if (!Array.isArray(v.plans) || v.plans.length > 100 || (v.coverage === "complete" && v.plans.length === 0)) throw new Error("invalid_plans");
  const plans: Plan[] = v.plans.map(raw => {
    const p = object(raw, ["id", "name", "amount", "currency", "interval", "evidence"]);
    const planId = identifier(p.id), name = text(p.name, 256), currency = text(p.currency, 3), interval = text(p.interval, 32);
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error("invalid_currency");
    if (p.amount === null) {
      if (p.evidence !== null) throw new Error("unexpected_price_evidence");
      return { id: planId, name, amount: null, currency, interval, evidence: null };
    }
    if (typeof p.amount !== "number" || !Number.isFinite(p.amount) || p.amount < 0 || p.amount > 1e12) throw new Error("invalid_amount");
    return { id: planId, name, amount: p.amount, currency, interval, evidence: validateAmountEvidence(p.amount, p.evidence) };
  });
  if (new Set(plans.map(p => p.id)).size !== plans.length) throw new Error("duplicate_plan_id");
  return { id, sourceUrl, capturedAt, coverage: v.coverage, plans };
}
