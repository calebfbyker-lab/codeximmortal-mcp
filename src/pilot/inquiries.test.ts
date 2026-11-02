import { describe,it,expect } from 'vitest';
import { mkdtemp,rm,readFile,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { createInquiryApp } from './inquiries.js';
const secret = 'sandbox-test-secret-never-use-in-live-1234';
const body = { product_id:'endpoint-preflight-pilot',target_url:'https://example.com/',intended_use:'Evaluate provider',max_total_minor:100,currency:'USD',mode:'sandbox' };
async function fixture(run: (f: any)=>Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(),'inquiry-test-'));
  const servers: Server[] = [];
  async function start() {
    const server = createInquiryApp({directory,secret}).listen(0,'127.0.0.1'); servers.push(server);
    await new Promise<void>(r=>server.once('listening',r));
    const a = server.address() as { port:number };
    return `http://127.0.0.1:${a.port}`;
  }
  try { await run({directory,start}); }
  finally { for (const s of servers) { s.closeAllConnections(); await new Promise<void>(r=>s.close(()=>r())); } await rm(directory,{recursive:true,force:true}); }
}
function post(base: string,key='test-idempotency-key-0001',input=body) {
  return fetch(`${base}/pilot/inquiries`,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(input)});
}
describe('sandbox inquiry HTTP acceptance',()=>{
  it('persists across app restart; replay is stable; tokens are not stored',async()=>fixture(async({start,directory}:any)=>{
    const a=await start(), first=await post(a); expect(first.status).toBe(201); const order=await first.json();
    const b=await start(), replay=await post(b); expect(replay.status).toBe(200); expect(await replay.json()).toEqual(order);
    const status=await fetch(b+order.status_path,{headers:{Authorization:`Bearer ${order.access_token}`}}); expect(status.status).toBe(200); expect((await status.json()).charged).toBe(false);
    const disk=await readFile(join(directory,'inquiries.json'),'utf8'); expect(disk).not.toContain(order.access_token); expect(JSON.parse(disk)).toHaveLength(1);
  }));
  it('serializes concurrent duplicates into one persisted row',async()=>fixture(async({start,directory}:any)=>{
    const base=await start(); const results=await Promise.all(Array.from({length:5},()=>post(base)));
    expect(results.filter(r=>r.status===201)).toHaveLength(1); expect(results.filter(r=>r.status===200)).toHaveLength(4);
    expect(JSON.parse(await readFile(join(directory,'inquiries.json'),'utf8'))).toHaveLength(1);
  }));
  it('rejects changed input for the same key',async()=>fixture(async({start}:any)=>{
    const base=await start(); await post(base); expect((await post(base,undefined,{...body,intended_use:'Changed'})).status).toBe(409);
  }));
  it('isolates tokens and hides unknown records',async()=>fixture(async({start}:any)=>{
    const base=await start(), a=await (await post(base)).json(), b=await (await post(base,'test-idempotency-key-0002')).json();
    expect((await fetch(base+a.status_path)).status).toBe(404);
    expect((await fetch(base+a.status_path,{headers:{Authorization:`Bearer ${b.access_token}`}})).status).toBe(404);
    expect((await fetch(base+'/pilot/inquiries/unknown',{headers:{Authorization:`Bearer ${a.access_token}`}})).status).toBe(404);
  }));
  it('rejects live mode, IP targets, URL credentials and unknown fields',async()=>fixture(async({start}:any)=>{
    const base=await start();
    for(const input of [{...body,mode:'live'},{...body,target_url:'https://127.0.0.1'},{...body,target_url:'https://user:password@example.com'},{...body,callback_url:'https://example.com'}]) expect((await post(base,undefined,input)).status).toBe(400);
  }));
  it('fails closed on corrupt persisted data',async()=>fixture(async({start,directory}:any)=>{
    const base=await start(); await writeFile(join(directory,'inquiries.json'),'corrupt');
    expect((await post(base)).status).toBe(503); expect(await readFile(join(directory,'inquiries.json'),'utf8')).toBe('corrupt');
  }));
  it('rejects oversized requests',async()=>fixture(async({start}:any)=>{
    const base=await start(); expect((await post(base,undefined,{...body,intended_use:'x'.repeat(9000)})).status).toBe(413);
  }));
});
