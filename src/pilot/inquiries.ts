import express from 'express';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';

class Fault extends Error { constructor(public status: number, message: string) { super(message); } }
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
type Input = { product_id: string; target_url: string; intended_use: string; max_total_minor: number; currency: string; mode: string };
type Row = { id: string; keyHash: string; fingerprint: string; tokenHash: string; input: Input; created_at: string };
function validate(b: any): Input {
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new Fault(400, 'invalid_input');
  const allowed = ['product_id','target_url','intended_use','max_total_minor','currency','mode'];
  if (Object.keys(b).some(k => !allowed.includes(k))) throw new Fault(400, 'unknown_field');
  if (b.product_id !== 'endpoint-preflight-pilot' || b.mode !== 'sandbox' || b.currency !== 'USD') throw new Fault(400, 'sandbox_product_required');
  if (!Number.isSafeInteger(b.max_total_minor) || b.max_total_minor < 100 || b.max_total_minor > 10000) throw new Fault(400, 'invalid_budget');
  if (typeof b.intended_use !== 'string' || !b.intended_use.trim() || b.intended_use.length > 1000) throw new Fault(400, 'invalid_intended_use');
  if (typeof b.target_url !== 'string' || b.target_url.length > 2048) throw new Fault(400, 'invalid_url');
  let u: URL; try { u = new URL(b.target_url); } catch { throw new Fault(400, 'invalid_url'); }
  const h = u.hostname.toLowerCase();
  if (u.protocol !== 'https:' || u.username || u.password || u.hash || (u.port && u.port !== '443') || isIP(h.replace(/[\[\]]/g,'')) || h.endsWith('.') || !h.includes('.') || /\.(local|internal|localhost|test|invalid)$/.test(h) || !h.split('.').every(s => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(s))) throw new Fault(400, 'unsupported_target');
  return { product_id: b.product_id, target_url: u.href, intended_use: b.intended_use.trim(), max_total_minor: b.max_total_minor, currency: b.currency, mode: b.mode };
}

export function createInquiryApp(config: { directory: string; secret: string; maxInquiries?: number }) {
  if (!config.directory || !config.secret || config.secret.length < 32) throw new Error('Explicit private storage directory and >=32-character secret required');
  const dir = resolve(config.directory), file = join(dir,'inquiries.json'), lock = join(dir,'.writer-lock');
  const token = (id: string) => createHmac('sha256',config.secret).update(`pilot:${id}`).digest('hex');
  const load = async (): Promise<Row[]> => {
    let text: string;
    try { text = await readFile(file,'utf8'); } catch (e: any) { if (e.code === 'ENOENT') return []; throw e; }
    const rows = JSON.parse(text);
    if (!Array.isArray(rows) || rows.some(r => !r.id || !r.tokenHash || !r.keyHash || !r.fingerprint || !r.input)) throw new Error('invalid_store');
    return rows;
  };
  const app = express();
  app.disable('x-powered-by');
  app.use((_req,res,next) => { res.set('Cache-Control','no-store'); next(); });
  app.use(express.json({ limit: '8kb', strict: true }));
  app.post('/pilot/inquiries', async (req,res,next) => {
    let locked = false;
    let temp: string | undefined;
    try {
      const input = validate(req.body);
      const key = req.get('Idempotency-Key');
      if (!key || !/^[A-Za-z0-9_-]{16,128}$/.test(key)) throw new Fault(400,'invalid_idempotency_key');
      await mkdir(dir,{recursive:true,mode:0o700});
      for (let n=0; ; n++) {
        try { await mkdir(lock,{mode:0o700}); locked = true; break; }
        catch (e: any) { if (e.code !== 'EEXIST' || n >= 99) throw new Fault(503,'store_busy'); await new Promise(r=>setTimeout(r,10)); }
      }
      const rows = await load(), keyHash = hash(key), fingerprint = hash(JSON.stringify(input));
      let row = rows.find(r=>r.keyHash === keyHash);
      const replay = Boolean(row);
      if (row && row.fingerprint !== fingerprint) throw new Fault(409,'IDEMPOTENCY_CONFLICT');
      if (!row) {
        if (rows.length >= (config.maxInquiries ?? 100)) throw new Fault(429,'pilot_capacity_reached');
        const id = randomUUID();
        row = { id, keyHash, fingerprint, tokenHash: hash(token(id)), input, created_at: new Date().toISOString() };
        rows.push(row);
        temp = join(dir,`${randomUUID()}.tmp`);
        await writeFile(temp,JSON.stringify(rows),{mode:0o600,flag:'wx'});
        await rename(temp,file); temp = undefined;
      }
      res.status(replay ? 200 : 201).json({ inquiry_id: row.id, status:'awaiting_scope_review', mode:'sandbox', payment_status:'not_requested', charged:false, fulfillment:'manual_concierge', quoted_amount_minor:null, access_token:token(row.id), status_path:`/pilot/inquiries/${row.id}`, poll_after_seconds:300 });
    } catch (e) { next(e); }
    finally { if (temp) await rm(temp,{force:true}).catch(()=>{}); if (locked) await rm(lock,{recursive:true,force:true}).catch(()=>{}); }
  });
  app.get('/pilot/inquiries/:id', async (req,res,next) => {
    try {
      const header = req.get('Authorization') ?? '';
      if (!/^Bearer [a-f0-9]{64}$/.test(header)) throw new Fault(404,'not_found');
      const row = (await load()).find(r=>r.id === req.params.id && r.tokenHash === hash(header.slice(7)));
      if (!row) throw new Fault(404,'not_found');
      res.json({ inquiry_id:row.id, created_at:row.created_at, status:'awaiting_scope_review', mode:'sandbox', payment_status:'not_requested', charged:false, product_id:row.input.product_id });
    } catch(e) { next(e); }
  });
  app.use((err: any,_req: express.Request,res: express.Response,_next: express.NextFunction) => {
    const status = err instanceof Fault ? err.status : err.type === 'entity.too.large' ? 413 : err.type === 'entity.parse.failed' ? 400 : 503;
    res.status(status).json({ error:err instanceof Fault ? err.message : status === 413 ? 'body_too_large' : status === 400 ? 'invalid_json' : 'storage_unavailable', charged:false });
  });
  return app;
}
