import { object, text, type Evidence } from "./contracts.js";
export function validateEvidence(value: unknown): Evidence {
  const v = object(value, ["text", "token"]);
  const source = text(v.text, 16384), token = text(v.token, 512);
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Unicode token boundaries prevent 99 matching 199, 99.5 or an identifier.
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_.])${escaped}(?![\\p{L}\\p{N}_.])`, "u");
  if (!pattern.test(source)) throw new Error("evidence_token_missing");
  return { text: source, token };
}
export function validateAmountEvidence(amount: number, value: unknown): Evidence {
  const evidence = validateEvidence(value);
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(evidence.token) || Number(evidence.token) !== amount) throw new Error("amount_evidence_mismatch");
  return evidence;
}
