import { mkdir,writeFile } from 'node:fs/promises';
import { run,type Plan } from './worker.js';
const fixtures:Plan[]=[{name:'Starter',amount:'19',currency:'USD',interval:'month',evidence:'Starter 19 USD monthly'},{name:'Team',amount:'120',currency:'EUR',interval:'year',evidence:'Team 120 EUR yearly'},{name:'Enterprise',amount:null,currency:null,interval:null,evidence:'Enterprise Contact sales'},{name:'Basic',amount:'9',currency:null,interval:'month',evidence:'Basic $9 monthly'}];
const rows=[];
for(const plan of fixtures){const r=await run(plan.evidence,{provider:async()=>({status:'completed',candidate:{plans:[plan]},usage:{inputTokens:100,outputTokens:50}}),audit:async()=>{},rates:{inputUsdPerMillion:1,outputUsdPerMillion:2,fixedJobUsd:0},maxJobUsd:1,maxOutputTokens:200});rows.push({fixture:plan.name,contract_pass:JSON.stringify(r.plans[0])===JSON.stringify(plan),synthetic_estimated_usd:r.estimated_cost_usd});}
await mkdir('results',{recursive:true});
await writeFile('results/evaluation.json',JSON.stringify({kind:'mock_contract_not_model_quality',rows},null,2));
await writeFile('results/evaluation.csv','fixture,contract_pass,synthetic_estimated_usd\n'+rows.map(r=>[r.fixture,r.contract_pass,r.synthetic_estimated_usd].join(',')).join('\n'));
if(rows.some(r=>!r.contract_pass))process.exitCode=1;
