import {describe,it,expect,vi} from 'vitest';
import {GrowthWorker} from './worker.js';
function fixture(){const runtime={claim:vi.fn().mockResolvedValue({id:'id',token:'token'}),renew:vi.fn().mockResolvedValue(true),complete:vi.fn().mockResolvedValue(true)};return {runtime,worker:new GrowthWorker(runtime,{name:'test'})};}
describe('worker truthful completion',()=>{
 it('does not complete after renewal refusal',async()=>{const {runtime,worker}=fixture();runtime.renew.mockResolvedValue(false);expect(await worker.step()).toBe('failed');expect(runtime.complete).not.toHaveBeenCalled();});
 it('does not report refused completion as success',async()=>{const {runtime,worker}=fixture();runtime.complete.mockResolvedValue(false);expect(await worker.step()).toBe('failed');});
 it('contains claim and renewal storage failures',async()=>{const {runtime,worker}=fixture();runtime.claim.mockRejectedValueOnce(Error('offline'));expect(await worker.step()).toBe('failed');runtime.renew.mockRejectedValueOnce(Error('offline'));expect(await worker.step()).toBe('failed');});
 it('backs off on failure and permits stop during backoff',async()=>{const {runtime}=fixture();runtime.claim.mockRejectedValue(Error('offline'));const sleep=vi.fn(async()=>{worker.stop();});const worker=new GrowthWorker(runtime,{name:'test',sleep,pollMs:100});await worker.run();expect(sleep).toHaveBeenCalledWith(100);expect(runtime.claim).toHaveBeenCalledTimes(1);});
});
