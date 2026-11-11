import { describe, it, expect } from "vitest";
import { validateDocument } from "./document-extract.js";
const sample = () => ({ profile: "scalar-fields-v1", pageCount: 1, fields: [{ name: "total", value: 10, page: 1, evidence: { text: "Total: 10", token: "10" } }] });
describe("synthetic document payload validation", () => {
  it("accepts a scalar payload", () => expect(validateDocument(sample()).fields[0].value).toBe(10));
  it("enforces page bounds", () => expect(() => validateDocument({ ...sample(), pageCount: 21 })).toThrow("invalid_page_count"));
  it("enforces field bounds", () => expect(() => validateDocument({ ...sample(), fields: Array(101).fill(sample().fields[0]) })).toThrow("invalid_field_count"));
  it("rejects nested values", () => expect(() => validateDocument({ ...sample(), fields: [{ ...sample().fields[0], value: {} }] })).toThrow("invalid_scalar"));
  it("rejects duplicate field names", () => { const v = sample(); v.fields.push(v.fields[0]); expect(() => validateDocument(v)).toThrow("duplicate_field_name"); });
  it("rejects wrong field attribution token", () => { const v = sample(); v.fields[0].evidence.token = "11"; expect(() => validateDocument(v)).toThrow(); });
});
