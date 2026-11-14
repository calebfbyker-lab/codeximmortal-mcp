export type Coverage = "partial" | "complete";
export interface Evidence { text: string; token: string; sourceStart: number; sourceEnd: number }
export interface Plan { id: string; name: string; amount: number | null; currency: string; interval: string; evidence: Evidence | null }
export interface Snapshot { id: string; sourceUrl: string; capturedAt: string; coverage: Coverage; plans: Plan[] }
export interface Comparison { planId: string; kind: "plan_added" | "plan_first_observed" | "plan_removed" | "plan_not_observed" | "price_unavailable" | "price_changed" | "terms_changed"; before: Plan | null; after: Plan | null }
export function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("invalid_object");
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(result, key))) throw new Error("invalid_fields");
  return result;
}
export function text(value: unknown, max = 512): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error("invalid_text");
  return value;
}
export function identifier(value: unknown): string {
  const result = text(value, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(result)) throw new Error("invalid_identifier");
  return result;
}
/** Stable JSON form: object keys sorted recursively so semantically equal
 *  payloads from different sources (in-memory vs jsonb round-trip) compare
 *  equal by string. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return "{" + entries.map(([k, v]) => JSON.stringify(k) + ":" + canonicalJson(v)).join(",") + "}";
}
