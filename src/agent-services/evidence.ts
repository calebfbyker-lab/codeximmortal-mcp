import { object, text, type Evidence } from "./contracts.js";

function isWordChar(ch: string | undefined): boolean {
  if (ch === undefined) return false;
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || (ch >= "0" && ch <= "9") || ch === "_" || ch === ".";
}

/** Standalone token match with word boundaries, so 99 never matches 199,
 *  99.5 or an identifier. Implemented without regexes. */
function containsStandaloneToken(source: string, token: string): boolean {
  let at = source.indexOf(token);
  while (at >= 0) {
    if (!isWordChar(source[at - 1]) && !isWordChar(source[at + token.length])) return true;
    at = source.indexOf(token, at + 1);
  }
  return false;
}

function validateSpanFields(v: Record<string, unknown>): Pick<Evidence, "sourceStart" | "sourceEnd"> {
  const start = v.sourceStart, end = v.sourceEnd;
  if (typeof start !== "number" || typeof end !== "number"
    || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)
    || start < 0 || end <= start || end - start > 16384) {
    throw new Error("invalid_evidence_span");
  }
  return { sourceStart: start, sourceEnd: end };
}

export function validateEvidence(value: unknown): Evidence {
  const v = object(value, ["text", "token", "sourceStart", "sourceEnd"]);
  const source = text(v.text, 16384), token = text(v.token, 512);
  const span = validateSpanFields(v);
  if (!containsStandaloneToken(source, token)) throw new Error("evidence_token_missing");
  return { text: source, token, sourceStart: span.sourceStart, sourceEnd: span.sourceEnd };
}

function isDigits(value: string): boolean {
  if (value.length === 0) return false;
  for (const ch of value) if (ch < "0" || ch > "9") return false;
  return true;
}

/** Canonical numeric token: 0 or a non-zero-leading integer, optionally with
 *  a fractional part. Implemented without regexes. */
function isCanonicalNumber(token: string): boolean {
  const dot = token.indexOf(".");
  if (dot < 0) return isDigits(token) && (token === "0" || !token.startsWith("0"));
  if (dot !== token.lastIndexOf(".")) return false;
  const whole = token.slice(0, dot);
  return isDigits(whole) && isDigits(token.slice(dot + 1)) && (whole === "0" || !whole.startsWith("0"));
}

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= "0" && ch <= "9";
}

/** Standalone numeric candidates including thousands grouping and signs,
 *  found by scanning rather than regex so grouping cannot be misread. */
function standaloneNumbers(source: string): number[] {
  const found: number[] = [];
  let index = 0;
  while (index < source.length) {
    const ch = source[index];
    if (!isDigit(ch) && !(ch === "-" && isDigit(source[index + 1]))) { index++; continue; }
    let end = index;
    while (end < source.length) {
      const c = source[end];
      if (isDigit(c) || c === "," || c === ".") end++;
      else break;
    }
    const parsed = Number(source.slice(index, end).split(",").join(""));
    if (Number.isFinite(parsed)) found.push(parsed);
    index = end;
  }
  return found;
}

/**
 * Numeric evidence requires a complete standalone number in the original
 * source text whose value equals the claimed amount. A bare substring match
 * cannot prove this: "10" inside "$10,000" or "-10" must not validate 10.
 * The span fields pin where the excerpt came from in the captured body.
 */
export function validateAmountEvidence(amount: number, value: unknown): Evidence {
  const v = object(value, ["text", "token", "sourceStart", "sourceEnd"]);
  const source = text(v.text, 16384), token = text(v.token, 512);
  const span = validateSpanFields(v);
  if (!isCanonicalNumber(token) || Number(token) !== amount) {
    throw new Error("amount_evidence_mismatch");
  }
  if (!standaloneNumbers(source).some(candidate => candidate === amount)) {
    throw new Error("amount_evidence_mismatch");
  }
  return { text: source, token, sourceStart: span.sourceStart, sourceEnd: span.sourceEnd };
}
