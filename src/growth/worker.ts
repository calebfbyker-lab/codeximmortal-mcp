import type { GrowthRuntime } from './runtime.js';
export type StepResult = 'idle' | 'completed' | 'failed';
export interface GrowthWorkerOptions { name:string; pollMs?:number; sleep?:(ms:number)=>Promise<void> }
type Runtime = Pick<GrowthRuntime,'claim'|'renew'|'complete'>;
export class GrowthWorker {
 private stopped=false;
 private readonly pollMs:number;
 private readonly sleepMs:(ms:number)=>Promise<void>;
 constructor(private readonly runtime:Runtime,private readonly options:GrowthWorkerOptions) {
  this.pollMs=options.pollMs??2000;
  this.sleepMs=options.sleep??(ms=>new Promise<void>(resolve=>{setTimeout(resolve,ms);}));
  if(!/^[a-zA-Z0-9_-]{1,64}$/.test(options.name)) throw Error('invalid_worker');
  if(!Number.isSafeInteger(this.pollMs)||this.pollMs<100||this.pollMs>60000) throw Error('invalid_poll_interval');
 }
 async step():Promise<StepResult> {
  try {
   const c=await this.runtime.claim(this.options.name);
   if(!c) return 'idle';
   if(!await this.runtime.renew(c.id,c.token)) return 'failed';
   return await this.runtime.complete(c.id,c.token)?'completed':'failed';
  } catch { return 'failed'; }
 }
 async run(signal?:AbortSignal):Promise<void> {
  this.stopped=false;
  while(!this.stopped&&!signal?.aborted) {
   const result=await this.step();
   if(this.stopped||signal?.aborted) return;
   if(result!=='completed') await this.sleepMs(this.pollMs);
  }
 }
 stop():void {this.stopped=true;}
}
