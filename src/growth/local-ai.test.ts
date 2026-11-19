import {describe,it,expect,vi} from 'vitest';
import {planLocally,validatePlan} from './local-ai.js';
const plan={objective:'Improve dashboard',actions:['Inspect owner workflow'],risks:['Authorization regression']};
function reply(v:unknown){return new Response(JSON.stringify({done:true,message:{content:JSON.stringify(v)}}));}
describe('local AI boundary',()=>{
 it('calls only the fixed loopback endpoint and validates the plan',async()=>{const send=vi.fn(async()=>reply(plan));expect(await planLocally('installed-model:local','Inspect dashboard',send)).toEqual(plan);expect(send.mock.calls).toHaveLength(1);});
 it('rejects cloud names before making requests',async()=>{const send=vi.fn(async()=>reply(plan));await expect(planLocally('model:cloud','task',send)).rejects.toThrow('explicit_local_model_required');expect(send).not.toHaveBeenCalled();});
 it('rejects oversized context',async()=>{const send=vi.fn(async()=>reply(plan));await expect(planLocally('local','x'.repeat(24001),send)).rejects.toThrow('invalid_context');expect(send).not.toHaveBeenCalled();});
 it('rejects malformed plans and extra authority fields',()=>{expect(()=>validatePlan({...plan,execute:true})).toThrow();expect(()=>validatePlan({...plan,actions:[]})).toThrow();});
 it('propagates transport failures without cloud fallback',async()=>{const send=vi.fn(async():Promise<Response>=>{throw Error('offline');});await expect(planLocally('local','task',send)).rejects.toThrow('offline');expect(send).toHaveBeenCalledTimes(1);});
});
