import {it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSecuredInquiryApp} from './secured-inquiries.js';

it('limits before parsing, ignores spoofed forwarded IP, and resets the window',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'pilot-security-')); let time=1000; const events: any[]=[];
  const server=createSecuredInquiryApp({directory,secret:'test-only-signing-secret-32-characters-long',windowMs:1000,requestsPerWindow:1,now:()=>time,logger:e=>events.push(e)}).listen(0,'127.0.0.1');
  await new Promise<void>(r=>server.once('listening',r)); const base=`http://127.0.0.1:${(server.address() as any).port}`;
  try {
    expect((await fetch(base+'/pilot/inquiries/missing')).status).toBe(404);
    const blocked=await fetch(base+'/pilot/inquiries',{method:'POST',headers:{'Content-Type':'application/json','X-Forwarded-For':'8.8.8.8'},body:'invalid json'});
    expect(blocked.status).toBe(429); expect(blocked.headers.get('Retry-After')).toBe('1');
    time+=1001; expect((await fetch(base+'/pilot/inquiries/missing')).status).toBe(404);
    expect(events.some(e=>e.rate_limited)).toBe(true);
  } finally {server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(directory,{recursive:true,force:true});}
});

it('logs only allowlisted metadata, not tokens, keys, bodies, IDs or query strings',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'pilot-redaction-')); const events: any[]=[];
  const server=createSecuredInquiryApp({directory,secret:'test-only-signing-secret-32-characters-long',logger:e=>events.push(e)}).listen(0,'127.0.0.1');
  await new Promise<void>(r=>server.once('listening',r));const base=`http://127.0.0.1:${(server.address() as any).port}`;
  const marker='DO_NOT_LOG_SECRET';
  try {
    const created=await fetch(base+'/pilot/inquiries',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':'redaction-test-key-001'},body:JSON.stringify({product_id:'endpoint-preflight-pilot',target_url:'https://example.com/',intended_use:marker,max_total_minor:100,currency:'USD',mode:'sandbox'})});
    expect(created.status).toBe(201);const order=await created.json();
    expect((await fetch(base+order.status_path+'?token='+marker,{headers:{Authorization:`Bearer ${order.access_token}`,'X-Api-Key':marker}})).status).toBe(200);
    const text=JSON.stringify(events);
    for(const value of [marker,order.access_token,order.inquiry_id,'redaction-test-key-001','https://example.com/']) expect(text).not.toContain(value);
    expect(events).toHaveLength(2);expect(events[1].authorization_present).toBe(true);expect(events[1].route).toBe('/pilot/inquiries/:id');
    expect(Object.keys(events[1]).sort()).toEqual(['event','request_id','method','route','status','duration_ms','authorization_present','rate_limited'].sort());
  } finally {server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(directory,{recursive:true,force:true});}
});
