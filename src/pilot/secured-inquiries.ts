import express from 'express';
import { randomUUID } from 'node:crypto';
import { createInquiryApp } from './inquiries.js';

type AccessEvent = { event: 'pilot_http'; request_id: string; method: string; route: string; status: number; duration_ms: number; authorization_present: boolean; rate_limited: boolean };
type Options = Parameters<typeof createInquiryApp>[0] & { windowMs?: number; requestsPerWindow?: number; maxClients?: number; logger?: (event: AccessEvent) => void; now?: () => number };

export function createSecuredInquiryApp(options: Options) {
  const windowMs = options.windowMs ?? 60000, limit = options.requestsPerWindow ?? 30, maxClients = options.maxClients ?? 1000;
  if (![windowMs,limit,maxClients].every(v=>Number.isSafeInteger(v) && v > 0)) throw new Error('Invalid rate limit configuration');
  const now = options.now ?? Date.now;
  const logger = options.logger ?? ((e: AccessEvent)=>console.info(JSON.stringify(e)));
  const buckets = new Map<string,{count:number; reset:number}>();
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use((req,res,next)=>{
    const started = now(), requestId = randomUUID();
    let limited = false;
    const route = req.path === '/pilot/inquiries' ? '/pilot/inquiries' : /^\/pilot\/inquiries\/[^/]+\/?$/.test(req.path) ? '/pilot/inquiries/:id' : 'unmatched';
    const authorizationPresent = Boolean(req.get('Authorization'));
    res.set('Cache-Control','no-store'); res.set('X-Request-Id',requestId);
    res.once('finish',()=>{
      const event: AccessEvent = {event:'pilot_http',request_id:requestId,method:['GET','POST','HEAD','OPTIONS'].includes(req.method)?req.method:'OTHER',route,status:res.statusCode,duration_ms:Math.max(0,now()-started),authorization_present:authorizationPresent,rate_limited:limited};
      try { logger(event); } catch { /* Logging must not expose request data or break responses. */ }
    });
    const time = now();
    for (const [key,b] of buckets) if (b.reset <= time) buckets.delete(key);
    const client = req.socket.remoteAddress ?? 'unknown';
    let bucket = buckets.get(client);
    const reject = (reset: number) => {
      limited = true;
      res.set('Retry-After',String(Math.max(1,Math.ceil((reset-time)/1000))));
      res.status(429).json({error:'rate_limited',charged:false,request_id:requestId});
    };
    if (!bucket) {
      if (buckets.size >= maxClients) { reject(time+windowMs); return; }
      bucket = {count:0,reset:time+windowMs}; buckets.set(client,bucket);
    }
    res.set('X-RateLimit-Limit',String(limit));
    if (bucket.count >= limit) { res.set('X-RateLimit-Remaining','0'); reject(bucket.reset); return; }
    bucket.count++;
    res.set('X-RateLimit-Remaining',String(limit-bucket.count));
    next();
  });
  app.use(createInquiryApp(options));
  app.use((_req,res)=>{res.status(404).json({error:'not_found',charged:false});});
  return app;
}
