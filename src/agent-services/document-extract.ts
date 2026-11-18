import { identifier, object, text } from "./contracts.js";
import { validateEvidence } from "./evidence.js";
export interface DocumentPayload { profile: "scalar-fields-v1"; pageCount: number; fields: { name: string; value: string | number | boolean | null; page: number; evidence: { text: string; token: string } | null }[] }
export function validateDocument(value: unknown): DocumentPayload {
  const v = object(value, ["profile", "pageCount", "fields"]);
  if (v.profile !== "scalar-fields-v1") throw new Error("invalid_profile");
  if (typeof v.pageCount !== "number" || !Number.isInteger(v.pageCount) || v.pageCount < 1 || v.pageCount > 20) throw new Error("invalid_page_count");
  const pageCount = v.pageCount;
  if (!Array.isArray(v.fields) || v.fields.length < 1 || v.fields.length > 100) throw new Error("invalid_field_count");
  const fields = v.fields.map(raw => {
    const f = object(raw, ["name", "value", "page", "evidence"]);
    const name = identifier(f.name);
    if (typeof f.page !== "number" || !Number.isInteger(f.page) || f.page < 1 || f.page > pageCount) throw new Error("invalid_page");
    const page = f.page;
    if (f.value === null) {
      if (f.evidence !== null) throw new Error("unexpected_null_evidence");
      return { name, value: null, page, evidence: null };
    }
    if (typeof f.value !== "string" && typeof f.value !== "number" && typeof f.value !== "boolean") throw new Error("invalid_scalar");
    if (typeof f.value === "number" && !Number.isFinite(f.value)) throw new Error("invalid_scalar");
    if (typeof f.value === "string") text(f.value, 4096);
    const evidence = validateEvidence(f.evidence);
    if (evidence.token !== String(f.value)) throw new Error("field_evidence_mismatch");
    return { name, value: f.value, page, evidence };
  });
  if (new Set(fields.map(f => f.name)).size !== fields.length) throw new Error("duplicate_field_name");
  return { profile: "scalar-fields-v1", pageCount, fields };
}
