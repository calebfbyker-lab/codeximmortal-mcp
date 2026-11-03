import { createHash } from 'node:crypto';
export type Plan = { name: string; amount: string|null; currency: string|null; interval: 'month'|'year'|'one_time'|null; evidence: string };
export type Usage = { inputTokens: number; outputTokens: number };
export type Rates = { inputUsdPerMillion: number; outputUsdPerMillion: number; fixedJobUsd: number };
export type Reply = { status: 'completed'|'incomplete'|'refused'; candidate?: unknown; usage: Usage };
export type Provider = (request: { text: string; maxOutputTokens: number }) => Promise<Reply>;
export type Options = { provider: Provider; audit: (event: Record<string,unknown>) => Promise<void>; rates: Rates; maxJobUsd: number; maxOutputTokens: number };
export class WorkerError extends Error {
  constructor(public code: string, public billing: 'not_called'|'known_usage'|'unknown', public usage?: Usage, public estimatedCostUsd?: number) { super(code); this.name='WorkerError'; }
}
const record = (x: unknown): x is Record<string,unknown> => typeof x==='object' && x!==null && !Array.isArray(x);
const keys = (x: Record<string,unknown>, expected: string[]) => Object.keys(x).length===expected.length && expected.every(k=>Object.hasOwn(x,k));
export function checkedUsage(x: unknown): Usage {
  if (!record(x) || !['inputTokens','outputTokens'].every(k=>Number.isSafeInteger(x[k]) && Number(x[k])>=0)) throw new Error('invalid_usage');
  return { inputTokens: Number(x.inputTokens), outputTokens: Number(x.outputTokens) };
}
export function cost(usage: Usage, rates: Rates): number {
  const u=checkedUsage(usage);
  if (![rates.inputUsdPerMillion,rates.outputUsdPerMillion,rates.fixedJobUsd].every(n=>Number.isFinite(n)&&n>=0)) throw new Error('invalid_rates');
  const total=(u.inputTokens*rates.inputUsdPerMillion+u.outputTokens*rates.outputUsdPerMillion)/1e6+rates.fixedJobUsd;
  if (!Number.isFinite(total)) throw new Error('invalid_cost');
  return total;
}
export function textOf(html: string): string {
  if (Buffer.byteLength(html)>512000) throw new Error('page_too_large');
  return html.replace(/<!--[\s\S]*?-->/g,' ').replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
}
export function validate(candidate: unknown, text: string): Plan[] {
  if (!record(candidate)||!keys(candidate,['plans'])||!Array.isArray(candidate.plans)||candidate.plans.length>50) throw new Error('invalid_schema');
  const names=new Set<string>();
  return candidate.plans.map(raw=>{
    if (!record(raw)||!keys(raw,['name','amount','currency','interval','evidence'])) throw new Error('invalid_plan_schema');
    const {name,amount,currency,interval,evidence}=raw;
    if (typeof name!=='string'||!name.trim()||name.length>200||typeof evidence!=='string'||!evidence||evidence.length>2000||!text.includes(evidence)||!evidence.includes(name)) throw new Error('invalid_evidence');
    const key=name.trim().toLowerCase(); if(names.has(key)) throw new Error('duplicate_plan'); names.add(key);
    if (amount!==null && (typeof amount!=='string'||!/^\d+(\.\d{1,4})?$/.test(amount)||!new RegExp('(^|[^0-9.])'+amount.replace('.','\\.')+'($|[^0-9.])').test(evidence))) throw new Error('unsupported_amount');
    if (currency!==null && (typeof currency!=='string'||!['USD','EUR','GBP','CAD','AUD','JPY'].includes(currency)||!new RegExp('\\b'+currency+'\\b').test(evidence))) throw new Error('unsupported_currency');
    if (interval!==null && interval!=='month' && interval!=='year' && interval!=='one_time') throw new Error('invalid_interval');
    if (interval==='month'&&!/\b(month|monthly)\b/i.test(evidence)) throw new Error('unsupported_interval');
    if (interval==='year'&&!/\b(year|yearly|annual|annually)\b/i.test(evidence)) throw new Error('unsupported_interval');
    if (interval==='one_time'&&!/\bone[- ]time\b/i.test(evidence)) throw new Error('unsupported_interval');
    return {name,amount,currency,interval,evidence} as Plan;
  });
}
export async function run(html: string, options: Options) {
  const {provider,audit,rates,maxJobUsd,maxOutputTokens}=options;
  cost({inputTokens:0,outputTokens:0},rates);
  if (!Number.isFinite(maxJobUsd)||maxJobUsd<=0||!Number.isSafeInteger(maxOutputTokens)||maxOutputTokens<1) throw new WorkerError('invalid_configuration','not_called');
  const text=textOf(html);
  if (!text||text.length>60000) throw new WorkerError(text?'page_text_too_large':'empty_page','not_called');
  const reserved=cost({inputTokens:Buffer.byteLength(text)+8192,outputTokens:maxOutputTokens},rates);
  if (reserved>maxJobUsd) throw new WorkerError('budget_rejected','not_called');
  await audit({event:'attempt',reserved_usd:reserved});
  let reply: Reply;
  try { reply=await provider({text,maxOutputTokens}); }
  catch { await audit({event:'provider_failure',billing:'unknown'}); throw new WorkerError('provider_failure','unknown'); }
  let usage: Usage;
  try { usage=checkedUsage(reply?.usage); }
  catch { await audit({event:'missing_usage',billing:'unknown'}); throw new WorkerError('missing_usage','unknown'); }
  const estimated=cost(usage,rates);
  await audit({event:'usage',usage,estimated_cost_usd:estimated,billing:'known_usage'});
  if(reply.status!=='completed') throw new WorkerError(reply.status==='refused'?'model_refusal':'model_incomplete','known_usage',usage,estimated);
  let plans: Plan[];
  try { plans=validate(reply.candidate,text); }
  catch(e) { throw new WorkerError(e instanceof Error?e.message:'invalid_result','known_usage',usage,estimated); }
  return {schema_version:'0.2.1',status:estimated>maxJobUsd?'over_budget':plans.length?'completed':'unsupported',plans,usage,estimated_cost_usd:estimated,source_sha256:createHash('sha256').update(html).digest('hex'),observed_at:new Date().toISOString()};
}
