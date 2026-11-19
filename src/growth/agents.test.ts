import { describe,it,expect } from 'vitest';
import { evaluate } from './agents.js';
describe('growth proposal contracts',()=>{
 it('preserves source evidence without asserting purchase intent',()=>{
  expect(evaluate('acquisition',{service:'pricing_snapshot',source:'inbound:1',evidence:'Customer asked about monitoring',observedAt:'2026-11-18T00:00:00Z',asOf:'2026-11-18T01:00:00Z'})).toMatchObject({status:'unverified_intent',externalAction:false});
 });
 it('rejects future observations',()=>{
  expect(()=>evaluate('acquisition',{service:'pricing_snapshot',source:'x',evidence:'x',observedAt:'2026-11-19T00:00:00Z',asOf:'2026-11-18T00:00:00Z'})).toThrow();
 });
 it('requires an adequate conversion cohort',()=>{expect(evaluate('conversion',{entered:5,completed:2})).toEqual({kind:'insufficient_sample'});});
 it('rejects incoherent cohorts',()=>{expect(()=>evaluate('conversion',{entered:30,completed:31})).toThrow('invalid_cohort');});
 it('keeps pricing proposals JSON safe and owner gated',()=>{const p=evaluate('pricing',{service:'pricing_snapshot',currentMinor:100,proposedMinor:120,currency:'USD'});expect(p.requiresOwnerApproval).toBe(true);expect(()=>JSON.stringify(p)).not.toThrow();});
 it('requires recurring errors before proposing code investigation',()=>{expect(evaluate('code_evolution',{occurrences:2})).toEqual({kind:'insufficient_sample'});});
});
