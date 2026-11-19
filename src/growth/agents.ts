export const roles = ['acquisition','conversion','pricing','code_evolution'] as const;
export type Role = typeof roles[number];
export function object(v: unknown): Record<string, unknown> {
 if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error('invalid_object');
 return v as Record<string, unknown>;
}
function text(v: unknown): string { if(typeof v!=='string'||!v.trim()||v.length>512) throw Error('invalid_text'); return v; }
function integer(v: unknown, min=0): number { if(typeof v!=='number'||!Number.isSafeInteger(v)||v<min||v>1000000000) throw Error('invalid_integer'); return v; }
export function evaluate(role: Role, raw: unknown): Record<string, unknown> {
 const v=object(raw);
 if(role==='acquisition') {
  const service=text(v.service), source=text(v.source), evidence=text(v.evidence);
  if(typeof v.observedAt!=='string'||typeof v.asOf!=='string') throw Error('invalid_time');
  const age=Date.parse(v.asOf)-Date.parse(v.observedAt);
  if(!Number.isFinite(age)||age<0||age>30*86400000) throw Error('stale_signal');
  if(!['pricing_snapshot','pricing_compare','document_extract'].includes(service)) throw Error('unsupported_service');
  return {kind:'opportunity_review',service,source,evidence,status:'unverified_intent',externalAction:false};
 }
 if(role==='conversion') {
  const entered=integer(v.entered), completed=integer(v.completed);
  if(completed>entered) throw Error('invalid_cohort');
  if(entered<30) return {kind:'insufficient_sample'};
  return {kind:'experiment_proposal',cohort:text(v.cohort),transition:text(v.transition),entered,completed,hypothesis:'Test clearer requirements and delivery evidence',requiresOwnerApproval:true};
 }
 if(role==='pricing') {
  const service=text(v.service), current=integer(v.currentMinor,1), proposed=integer(v.proposedMinor,1);
  return {kind:'pricing_review',service,currentMinor:current,proposedMinor:proposed,currency:text(v.currency),requiresOwnerApproval:true,note:'No elasticity inference or owner-bound authorization is established by this record'};
 }
 if(role==='code_evolution') {
  const occurrences=integer(v.occurrences);
  if(occurrences<5) return {kind:'insufficient_sample'};
  return {kind:'repair_investigation',errorCode:text(v.errorCode),baseline:text(v.baseline),occurrences,requiredEvidence:['build','unit_tests','db_regression','remote_ci'],requiresOwnerApproval:true};
 }
 throw Error('invalid_role');
}
