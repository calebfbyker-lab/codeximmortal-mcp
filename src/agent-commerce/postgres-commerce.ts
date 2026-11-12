import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { ApiError, digest, identifier, validateInput, type Dependencies, type Principal, type Service } from "./api.js";
const SERVICES = ["pricing_snapshot", "pricing_compare", "document_extract"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Backend = Dependencies["backend"];
type Submit = Parameters<Dependencies["backend"]["submit"]>[1];
export class PostgresCommerce implements Backend {
  private readonly s: string;
  constructor(private readonly pool: Pool, schema = "agent_commerce") {
    if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) throw new Error("invalid_commerce_schema");
    this.s = `"${schema}"`;
  }
  private async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect().catch(() => { throw new ApiError(503, "commerce_unavailable"); });
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL statement_timeout = '5000ms'");
      await c.query("SET LOCAL lock_timeout = '3000ms'");
      const value = await fn(c); await c.query("COMMIT"); return value;
    } catch(e) {
      await c.query("ROLLBACK").catch(() => undefined);
      if (e instanceof ApiError) throw e;
      throw new ApiError(503, "commerce_unavailable");
    } finally { c.release(); }
  }
  // Called only with a verified issuer and introspected subject, never tool-input identity.
  async resolve(issuer: string, subject: Principal): Promise<Principal> {
    return this.tx(async c => {
      const r = await c.query(`SELECT b.id,d.scopes FROM ${this.s}.buyers b JOIN ${this.s}.delegations d ON d.buyer_id=b.id WHERE b.issuer=$1 AND b.subject=$2 AND d.client_id=$3 AND b.active AND d.active AND d.expires_at>clock_timestamp()`, [issuer,subject.buyerId,subject.clientId]);
      if (r.rowCount !== 1) throw new ApiError(403,"delegation_denied");
      return { buyerId:r.rows[0].id, clientId:subject.clientId, scopes:subject.scopes.filter(s => r.rows[0].scopes.includes(s)) };
    });
  }
  private async authorize(c: PoolClient, p: Principal, scope: string, service?: Service) {
    if (!UUID.test(p.buyerId)) throw new ApiError(401,"unauthorized");
    // All backend operations use the same lock order: buyer then delegation.
    const b = await c.query(`SELECT currency FROM ${this.s}.buyers WHERE id=$1 AND active FOR UPDATE`,[p.buyerId]);
    const d = await c.query(`SELECT * FROM ${this.s}.delegations WHERE buyer_id=$1 AND client_id=$2 AND active AND expires_at>clock_timestamp() FOR UPDATE`,[p.buyerId,p.clientId]);
    if (b.rowCount !== 1 || d.rowCount !== 1) throw new ApiError(403,"delegation_denied");
    if (!p.scopes.includes(scope) || !d.rows[0].scopes.includes(scope)) throw new ApiError(403,"insufficient_scope");
    if (service && !d.rows[0].services.includes(service)) throw new ApiError(403,"service_not_delegated");
    return { currency: b.rows[0].currency as string, delegation: d.rows[0] };
  }
  private input(s: Service, raw: Record<string,unknown>) {
    if (!SERVICES.includes(s)) throw new ApiError(400,"unknown_service");
    return validateInput(s,raw);
  }
  private async owned(c: PoolClient, p: Principal, s: Service, v: Record<string,unknown>) {
    const kind = s === "pricing_snapshot" ? "source" : s === "pricing_compare" ? "snapshot" : "document";
    const ids = s === "pricing_snapshot" ? [v.sourceId] : s === "pricing_compare" ? [v.beforeId,v.afterId] : [v.documentId];
    if (s === "pricing_compare" && v.beforeId === v.afterId) throw new ApiError(400,"distinct_snapshots_required");
    for (const id of [...ids].sort()) {
      const r = await c.query(`SELECT id FROM ${this.s}.resources WHERE buyer_id=$1 AND kind=$2 AND id=$3 AND ready FOR SHARE`,[p.buyerId,kind,id]);
      if (r.rowCount !== 1) throw new ApiError(404,"not_found");
    }
  }
  async quote(p: Principal, service: Service, raw: Record<string,unknown>) {
    const input = this.input(service,raw);
    return this.tx(async c => {
      const a = await this.authorize(c,p,"commerce:quote",service);
      await this.owned(c,p,service,input);
      const prices = await c.query(`SELECT * FROM ${this.s}.prices WHERE service=$1 AND enabled FOR SHARE`,[service]);
      const price = prices.rows[0];
      if (!price || price.currency !== a.currency) throw new ApiError(503,"service_unpriced");
      const id = randomUUID();
      const r = await c.query(`INSERT INTO ${this.s}.quotes(id,buyer_id,client_id,service,input,input_digest,price_version,currency,amount_minor,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,clock_timestamp()+interval '5 minutes') RETURNING expires_at`,[id,p.buyerId,p.clientId,service,JSON.stringify(input),digest({service,input}),price.version,price.currency,price.amount_minor]);
      return {id,service,amountMinor:price.amount_minor,currency:price.currency,expiresAt:r.rows[0].expires_at.toISOString()};
    });
  }
  async submit(p: Principal, v: Submit) {
    const input = this.input(v.service,v.input); identifier(v.quoteId);
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(v.idempotencyKey)) throw new ApiError(400,"idempotency_key_required");
    const requestDigest = digest({service:v.service,input,quoteId:v.quoteId});
    if (v.digest !== requestDigest) throw new ApiError(400,"invalid_request_digest");
    return this.tx(async c => {
      const a = await this.authorize(c,p,"services:execute",v.service);
      const prior = await c.query(`SELECT id,status,request_digest FROM ${this.s}.jobs WHERE buyer_id=$1 AND client_id=$2 AND idempotency_key=$3`,[p.buyerId,p.clientId,v.idempotencyKey]);
      if (prior.rowCount) {
        if (prior.rows[0].request_digest !== requestDigest) throw new ApiError(409,"idempotency_conflict");
        return {id:prior.rows[0].id,status:prior.rows[0].status};
      }
      const qs = await c.query(`SELECT *,expires_at>clock_timestamp() AS valid FROM ${this.s}.quotes WHERE id=$1 AND buyer_id=$2 AND client_id=$3 FOR UPDATE`,[v.quoteId,p.buyerId,p.clientId]);
      const q = qs.rows[0]; if (!q) throw new ApiError(404,"not_found");
      if (!q.valid) throw new ApiError(409,"quote_expired");
      if (q.service !== v.service || q.currency !== a.currency || q.input_digest !== digest({service:v.service,input})) throw new ApiError(409,"quote_mismatch");
      const live = await c.query(`SELECT service FROM ${this.s}.prices WHERE service=$1 AND enabled FOR SHARE`,[v.service]);
      if (!live.rowCount) throw new ApiError(503,"service_disabled");
      const used = await c.query(`SELECT id FROM ${this.s}.jobs WHERE quote_id=$1`,[q.id]);
      if (used.rowCount) throw new ApiError(409,"quote_already_used");
      await this.owned(c,p,v.service,input);
      const open = await c.query(`SELECT count(*)::int AS n FROM ${this.s}.jobs WHERE buyer_id=$1 AND client_id=$2 AND status IN ('queued','running')`,[p.buyerId,p.clientId]);
      if (open.rows[0].n >= a.delegation.max_open_jobs) throw new ApiError(429,"job_limit",60);
      const budget = await c.query(`UPDATE ${this.s}.delegations SET reserved_minor=reserved_minor+$3 WHERE buyer_id=$1 AND client_id=$2 AND reserved_minor+spent_minor+$3<=limit_minor RETURNING buyer_id`,[p.buyerId,p.clientId,q.amount_minor]);
      if (!budget.rowCount) throw new ApiError(403,"spending_limit");
      const wallet = await c.query(`UPDATE ${this.s}.wallets SET available_minor=available_minor-$2,held_minor=held_minor+$2 WHERE buyer_id=$1 AND available_minor>=$2 RETURNING buyer_id`,[p.buyerId,q.amount_minor]);
      if (!wallet.rowCount) throw new ApiError(402,"payment_required");
      const id=randomUUID();
      await c.query(`INSERT INTO ${this.s}.jobs(id,buyer_id,client_id,service,input,quote_id,idempotency_key,request_digest,amount_minor,currency) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[id,p.buyerId,p.clientId,v.service,JSON.stringify(input),q.id,v.idempotencyKey,requestDigest,q.amount_minor,q.currency]);
      await c.query(`INSERT INTO ${this.s}.reservations(job_id,amount_minor) VALUES($1,$2)`,[id,q.amount_minor]);
      await c.query(`INSERT INTO ${this.s}.ledger(buyer_id,job_id,kind,available_delta,held_delta) VALUES($1,$2,'reserve',-$3::bigint,$3::bigint)`,[p.buyerId,id,q.amount_minor]);
      await c.query(`INSERT INTO ${this.s}.outbox(job_id) VALUES($1)`,[id]);
      return {id,status:"queued"};
    });
  }
  async job(p: Principal, id: string) {
    identifier(id);
    return this.tx(async c => { await this.authorize(c,p,"jobs:read"); const r=await c.query(`SELECT id,status FROM ${this.s}.jobs WHERE id=$1 AND buyer_id=$2 AND client_id=$3`,[id,p.buyerId,p.clientId]); return r.rows[0] ?? null; });
  }
  async result(p: Principal, id: string) {
    identifier(id);
    return this.tx(async c => { await this.authorize(c,p,"results:read"); const r=await c.query(`SELECT j.id AS "jobId",j.service,r.value,r.receipt_id AS "receiptId" FROM ${this.s}.jobs j JOIN ${this.s}.results r ON r.job_id=j.id JOIN ${this.s}.reservations h ON h.job_id=j.id WHERE j.id=$1 AND j.buyer_id=$2 AND j.client_id=$3 AND j.status='succeeded' AND h.state='consumed'`,[id,p.buyerId,p.clientId]); return r.rows[0] ?? null; });
  }
}
