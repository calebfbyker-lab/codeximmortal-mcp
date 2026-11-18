import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { ApiError } from "api.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURRENCY = /^[A-Z]{3}$/;
const MAX_AMOUNT_MINOR = 1_000_000_000_000;

export type FundingProvider = "stripe" | "crypto";
export type FundingMode = "test" | "live";
export type FundingRejectionCode =
  | "duplicate_event" | "unknown_order" | "already_credited" | "order_cancelled"
  | "order_expired" | "buyer_inactive" | "currency_mismatch" | "amount_mismatch";

export interface FundingOrderInput {
  buyerId: string; provider: FundingProvider; providerRef: string; mode: FundingMode;
  amountMinor: number; currency: string; ttlSeconds?: number;
}
export interface FundingOrderHandle {
  id: string; provider: FundingProvider; providerRef: string; mode: FundingMode;
  amountMinor: string; currency: string; status: string; expiresAt: string;
}
export interface FundingCreditInput {
  provider: FundingProvider; providerEventId: string; providerRef: string;
  amountMinor: number; currency: string; evidence?: unknown;
}
export type FundingCreditResult =
  | { credited: true; orderId: string; availableMinor: string }
  | { credited: false; code: FundingRejectionCode };

/**
 * Rail-agnostic funding settlement. Payment adapters (Stripe webhooks, crypto
 * deposit detection) verify money arrival and then call credit(); buyer
 * identity always comes from the persisted funding order, never from event
 * metadata. All wallet and ledger mutation happens in one transaction using
 * the same buyer-first lock order as admission and the durable worker, so no
 * lock inversion is possible with concurrent job submission or settlement.
 */
export class PostgresFunding {
  private readonly s: string;
  constructor(private readonly pool: Pool, schema = "agent_commerce") {
    if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) throw new Error("invalid_commerce_schema");
    this.s = `"${schema}"`;
  }

  private async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect().catch(() => { throw new ApiError(503, "funding_unavailable"); });
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL statement_timeout = '5000ms'");
      await c.query("SET LOCAL lock_timeout = '3000ms'");
      const value = await fn(c); await c.query("COMMIT"); return value;
    } catch (e) {
      await c.query("ROLLBACK").catch(() => undefined);
      if (e instanceof ApiError) throw e;
      throw new ApiError(503, "funding_unavailable");
    } finally { c.release(); }
  }

  private static provider(v: unknown): FundingProvider {
    if (v !== "stripe" && v !== "crypto") throw new ApiError(400, "unknown_funding_provider");
    return v;
  }
  private static ref(v: unknown, code: string): string {
    if (typeof v !== "string" || v.length < 1 || v.length > 256) throw new ApiError(400, code);
    return v;
  }
  private static amount(v: unknown): number {
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 1 || v > MAX_AMOUNT_MINOR) throw new ApiError(400, "invalid_funding_amount");
    return v;
  }
  private static currency(v: unknown): string {
    if (typeof v !== "string" || !CURRENCY.test(v)) throw new ApiError(400, "invalid_funding_currency");
    return v;
  }
  private static evidence(v: unknown): string {
    const encoded = JSON.stringify(v ?? {});
    if (encoded === undefined || Buffer.byteLength(encoded) > 32768) throw new ApiError(400, "invalid_funding_evidence");
    return encoded;
  }

  /**
   * Creates the server-owned payment binding. Idempotent for an identical
   * pending order; conflicting reuse of a provider payment reference is a 409.
   * The payment adapter supplies the reference after creating the provider-side
   * intent or deposit expectation — callers never mint references from thin air.
   */
  async openOrder(input: FundingOrderInput): Promise<FundingOrderHandle> {
    const provider = PostgresFunding.provider(input?.provider);
    const providerRef = PostgresFunding.ref(input?.providerRef, "invalid_funding_ref");
    if (input?.mode !== "test" && input?.mode !== "live") throw new ApiError(400, "invalid_funding_mode");
    const amountMinor = PostgresFunding.amount(input?.amountMinor);
    const currency = PostgresFunding.currency(input?.currency);
    if (!UUID.test(input?.buyerId ?? "")) throw new ApiError(400, "invalid_buyer");
    const buyerId = input.buyerId.toLowerCase();
    const ttl = input.ttlSeconds ?? 86400;
    if (!Number.isSafeInteger(ttl) || ttl < 60 || ttl > 2_592_000) throw new ApiError(400, "invalid_funding_ttl");
    return this.tx(async c => {
      // Buyer first, always: same lock order as admission, worker, and credit.
      const b = await c.query(`SELECT id, currency, active FROM ${this.s}.buyers WHERE id=$1 FOR UPDATE`, [buyerId]);
      if (b.rowCount !== 1 || b.rows[0].active !== true) throw new ApiError(403, "buyer_inactive");
      if (b.rows[0].currency !== currency) throw new ApiError(409, "currency_mismatch");
      const existing = await c.query(
        `SELECT id, buyer_id, amount_minor, currency, mode, status, expires_at > clock_timestamp() AS live, expires_at
           FROM ${this.s}.funding_orders WHERE provider=$1 AND provider_ref=$2`, [provider, providerRef]);
      if (existing.rowCount) {
        const row = existing.rows[0];
        if (row.buyer_id !== buyerId || String(row.amount_minor) !== String(amountMinor)
          || row.currency !== currency || row.mode !== input.mode) throw new ApiError(409, "funding_ref_conflict");
        if (row.status !== "pending") throw new ApiError(409, "order_already_finalized");
        if (row.live !== true) throw new ApiError(409, "order_expired");
        return { id: row.id, provider, providerRef, mode: input.mode, amountMinor: String(row.amount_minor), currency, status: row.status, expiresAt: row.expires_at.toISOString() };
      }
      const id = randomUUID();
      const inserted = await c.query(
        `INSERT INTO ${this.s}.funding_orders(id, buyer_id, provider, provider_ref, mode, amount_minor, currency, expires_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp()+($8::int*interval '1 second'))
         RETURNING id, status, expires_at`, [id, buyerId, provider, providerRef, input.mode, amountMinor, currency, ttl]);
      const row = inserted.rows[0];
      return { id: row.id, provider, providerRef, mode: input.mode, amountMinor: String(amountMinor), currency, status: row.status, expiresAt: row.expires_at.toISOString() };
    });
  }

  /**
   * Atomically settles one verified provider event into at most one wallet
   * credit. Duplicate deliveries, replayed payments, mismatches, and unknown
   * references are recorded as rejected events with codes — never as errors
   * that would trigger redelivery loops — and perform no financial writes.
   */
  async credit(input: FundingCreditInput): Promise<FundingCreditResult> {
    const provider = PostgresFunding.provider(input?.provider);
    const providerEventId = PostgresFunding.ref(input?.providerEventId, "invalid_funding_event_id");
    const providerRef = PostgresFunding.ref(input?.providerRef, "invalid_funding_ref");
    const amountMinor = PostgresFunding.amount(input?.amountMinor);
    const currency = PostgresFunding.currency(input?.currency);
    const payload = PostgresFunding.evidence(input?.evidence);
    return this.tx(async c => {
      const eventId = randomUUID();
      const inserted = await c.query(
        `INSERT INTO ${this.s}.funding_events(id, provider, provider_event_id, provider_ref, payload)
         VALUES($1,$2,$3,$4,$5::jsonb)
         ON CONFLICT(provider, provider_event_id) DO NOTHING RETURNING id`, [eventId, provider, providerEventId, providerRef, payload]);
      if (inserted.rowCount === 0) return { credited: false as const, code: "duplicate_event" as const };
      const reject = async (code: FundingRejectionCode): Promise<FundingCreditResult> => {
        await c.query(`UPDATE ${this.s}.funding_events SET status='rejected', error_code=$2, settled_at=clock_timestamp() WHERE id=$1`, [eventId, code]);
        return { credited: false as const, code };
      };
      // Buyer first, then order: the admission lock order, inverted nowhere.
      const order = await c.query(
        `SELECT o.id, o.buyer_id, o.amount_minor, o.currency, o.status,
                o.expires_at > clock_timestamp() AS live, b.active, b.currency AS buyer_currency
           FROM ${this.s}.funding_orders o
           JOIN ${this.s}.buyers b ON b.id = o.buyer_id
          WHERE o.provider=$1 AND o.provider_ref=$2
          FOR UPDATE OF b, o`, [provider, providerRef]);
      const row = order.rows[0];
      if (!row) return reject("unknown_order");
      if (row.status === "credited") return reject("already_credited");
      if (row.status === "cancelled") return reject("order_cancelled");
      if (row.live !== true) return reject("order_expired");
      if (row.active !== true) return reject("buyer_inactive");
      // Exact match policy: the verified event must match the server-owned binding.
      if (row.buyer_currency !== row.currency || currency !== row.currency) return reject("currency_mismatch");
      if (BigInt(amountMinor) !== BigInt(row.amount_minor)) return reject("amount_mismatch");
      const externalRef = `${provider}:${providerRef}`;
      // Payment-level backstop: the unique ledger reference must be unclaimed.
      const prior = await c.query(`SELECT 1 FROM ${this.s}.ledger WHERE external_ref=$1`, [externalRef]);
      if (prior.rowCount) return reject("already_credited");
      const wallet = await c.query(
        `INSERT INTO ${this.s}.wallets AS w (buyer_id, available_minor) VALUES($1,$2::bigint)
         ON CONFLICT(buyer_id) DO UPDATE SET available_minor = w.available_minor + $2::bigint
         RETURNING available_minor`, [row.buyer_id, amountMinor]);
      await c.query(
        `INSERT INTO ${this.s}.ledger(buyer_id, kind, available_delta, held_delta, external_ref)
         VALUES($1,'fund',$2::bigint,0,$3)`, [row.buyer_id, amountMinor, externalRef]);
      const finalized = await c.query(
        `UPDATE ${this.s}.funding_orders SET status='credited', credited_at=clock_timestamp()
         WHERE id=$1 AND status='pending' RETURNING id`, [row.id]);
      if (finalized.rowCount !== 1) throw new ApiError(503, "funding_unavailable");
      await c.query(`UPDATE ${this.s}.funding_events SET status='settled', settled_at=clock_timestamp() WHERE id=$1`, [eventId]);
      return { credited: true as const, orderId: row.id, availableMinor: String(wallet.rows[0].available_minor) };
    });
  }
}
