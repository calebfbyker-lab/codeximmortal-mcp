import {planLocally} from './local-ai.js';
// Candidate planning only. No repo writes, command execution, queue status changes or outreach.
// Before use: disable cloud features in the local Ollama server and select a downloaded model.
// Model-name checks cannot detect a custom alias backed by a remote service.
if(process.env.GROWTH_LOCAL_AI!=='on')throw Error('GROWTH_LOCAL_AI_not_enabled');
const model=process.env.GROWTH_LOCAL_MODEL;
if(!model)throw Error('GROWTH_LOCAL_MODEL_required');
let size=0;const chunks:Buffer[]=[];
for await(const chunk of process.stdin){const b=Buffer.from(chunk);size+=b.length;if(size>24000)throw Error('invalid_context');chunks.push(b);}
const context=Buffer.concat(chunks).toString('utf8');
const plan=await planLocally(model,context);
process.stdout.write(JSON.stringify({status:'untrusted_candidate',execution:false,model,plan},null,2)+'\n');
