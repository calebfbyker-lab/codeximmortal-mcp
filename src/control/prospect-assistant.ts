import { proposedServices } from '../agent-services/registry.js';
export class ProspectInputError extends Error {
  constructor() { super('invalid_prospect_input'); }
}
export function prospectIntake(raw: Record<string, unknown>) {
  const allowed = new Set(['csrf', 'name', 'source', 'need']);
  if (Object.keys(raw).some(k => !allowed.has(k))) throw new ProspectInputError();
  const text = (key: string, max: number) => {
    const v = raw[key];
    if (typeof v !== 'string' || !v.trim() || v.length > max || /[\u0000-\u001f\u007f]/.test(v)) throw new ProspectInputError();
    return v.trim();
  };
  const name = text('name', 200), source = text('source', 64), need = text('need', 600);
  // Deterministic hints, not an LLM, verified intent, or a lead probability.
  const patterns: Array<[string, RegExp]> = [
    ['codex_pricing_snapshot', /\b(pricing|price|snapshot)\b/i],
    ['codex_pricing_compare', /\b(compare|comparison|changes?)\b/i],
    ['codex_document_extract', /\b(document|extract|extraction|pdf)\b/i],
  ];
  const candidates = patterns.filter(([, re]) => re.test(need)).map(([tool]) => tool);
  const matches = proposedServices.filter(s => candidates.includes(s.tool)).map(s => ({ tool: s.tool, status: s.status, registered: s.registered }));
  const assessment = {
    schema: 'prospect-assist-v1', method: 'rules-v1', evidence: 'owner_recorded_unverified',
    identity: 'unverified', contactPermission: 'not_established', need, matches,
    nextAction: matches.length ? 'Review product fit and availability with owner; clarify requirements.' : 'Clarify the requested outcome before recommending a product.',
    draft: matches.length
      ? 'Draft only: Please clarify your required inputs, output format, volume and timing. Potential matches are pre-release services; availability and commercial terms require owner review.'
      : 'Draft only: Please describe the task, inputs and desired result so the owner can assess fit.',
  };
  const notes = JSON.stringify(assessment);
  if (notes.length > 2000) throw new ProspectInputError();
  return { source, name, valueMinor: 0, currency: 'USD', notes };
}
