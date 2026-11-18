import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { ApiError, identifier, type Principal } from "./api.js";
import type { DepositInstructions, FundingOrderBackend } from "./funding-router.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function instructionsFromRow(row: Record<string, unknown>): DepositInstructions {
  const expiresAt = row.expires_at as Date;
  const status = row.status === "credited" ? "credited"
    : row.status === "pending" && expiresAt.getTime() > Date.now() ? "awaiting_payment" : "expired";
  return {
    orderId: String(row.id),
    reference: String(row.provider_ref),
    status,
    network: String(row.network),
    asset: { symbol: String(row.asset_symbol), contract: String(row.token_contract), decimals: Number(row.decimals) },
    recipient: String(row.recipient_address),
    amountAtomic: String(row.amount_atomic),
    credit: { amountMinor: String(row.amount_minor), currency: String(row.currency) },
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * PostgreSQL deposit-intent backend for the agent funding API. Creating an
 * intent never writes wallet or ledger rows: it binds an authenticated
 * buyer/client to an operator-configured package and returns deposit
 * instructions with a network-unique deposit amount. Buyer identity for any
 * later credit comes from the persisted funding order, never from request
 * input. Lock order is buyer first, then delegation — the order used by
 * admission, worker settlement, and funding settlement.
 */
export class PostgresFundingOrders implements FundingOrderBackend {
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

  async create(p: Principal, input: { packageId: string; idempotencyKey: string }): Promise<{ created: boolean; instructions: DepositInstructions }> {
    const packageId = identifier(input?.packageId);
    const key = input?.idempotencyKey;
    if (typeof key !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(key)) throw new ApiError(400, "idempotency_key_required");
    if (!UUID.test(p?.buyerId ?? "") || typeof p?.clientId !== "string" || !Array.isArray(p.scopes)) throw new ApiError(401, "unauthorized");
    const buyerId = p.buyerId.toLowerCase();
    return this.tx(async c => {
      // Buyer first, then delegation: the admission lock order.
      const b = await c.query(`SELECT currency FROM ${this.s}.buyers WHERE id=$1 AND active FOR UPDATE`, [buyerId]);
      if (b.rowCount !== 1) throw new ApiError(403, "delegation_denied");
      const d = await c.query(`SELECT scopes FROM ${this.s}.delegations WHERE buyer_id=$1 AND client_id=$2 AND active AND expires_at>clock_timestamp() FOR UPDATE`, [buyerId, p.clientId]);
      if (d.rowCount !== 1) throw new ApiError(403, "delegation_denied");
      if (!d.rows[0].scopes.includes("funding:create") || !p.scopes.includes("funding:create")) throw new ApiError(403, "insufficient_scope");
      const prior = await c.query(
        `SELECT k.package_id, o.id, o.provider_ref, o.status, o.expires_at, o.network, o.token_contract,
                o.asset_symbol, o.decimals, o.recipient_address, o.amount_atomic, o.amount_minor, o.currency
           FROM ${this.s}.funding_intent_keys k
           JOIN ${this.s}.funding_orders o ON o.id = k.order_id
          WHERE k.buyer_id=$1 AND k.client_id=$2 AND k.idempotency_key=$3`, [buyerId, p.clientId, key]);
      if (prior.rowCount) {
        if (prior.rows[0].package_id !== packageId) throw new ApiError(409, "idempotency_conflict");
        return { created: false, instructions: instructionsFromRow(prior.rows[0]) };
      }
      const pkg = await c.query(`SELECT * FROM ${this.s}.funding_packages WHERE id=$1 FOR SHARE`, [packageId]);
      const packageRow = pkg.rows[0];
      if (pkg.rowCount !== 1 || packageRow.active !== true) throw new ApiError(404, "unknown_package");
      if (packageRow.currency !== b.rows[0].currency) throw new ApiError(409, "currency_mismatch");
      const open = await c.query(
        `SELECT count(*)::int AS n FROM ${this.s}.funding_orders
          WHERE buyer_id=$1 AND provider='crypto' AND status='pending' AND expires_at>clock_timestamp()`, [buyerId]);
      if (open.rows[0].n >= packageRow.max_open_intents) throw new ApiError(429, "funding_limit", 60);
      // Unique deposit amount: every pending crypto intent on this network
      // holds a distinct amount_atomic in [base, base + atomic_uniqueness),
      // so one on-chain transfer amount attributes to at most one intent.
      // The partial unique index enforces this; a racing insert rolls back
      // and the agent retries the same idempotency key.
      const used = await c.query(
        `SELECT amount_atomic FROM ${this.s}.funding_orders WHERE provider='crypto' AND status='pending' AND network=$1`,
        [packageRow.network]);
      const taken = new Set(used.rows.map((row: { amount_atomic: unknown }) => String(row.amount_atomic)));
      const base = BigInt(packageRow.amount_atomic);
      let amountAtomic: bigint | undefined;
      for (let u = 0; u < Number(packageRow.atomic_uniqueness); u++) {
        const candidate = base + BigInt(u);
        if (!taken.has(candidate.toString())) { amountAtomic = candidate; break; }
      }
      if (amountAtomic === undefined) throw new ApiError(429, "funding_slots_exhausted", 60);
      const id = randomUUID();
      const ref = `dep_${randomUUID()}`;
      const inserted = await c.query(
        `INSERT INTO ${this.s}.funding_orders
           (id, buyer_id, provider, provider_ref, mode, amount_minor, currency, expires_at,
            network, token_contract, asset_symbol, decimals, recipient_address, amount_atomic)
         VALUES($1,$2,'crypto',$3,$4,$5,$6,clock_timestamp()+($7::int*interval '1 second'),$8,$9,$10,$11,$12,$13)
         RETURNING id, provider_ref, status, expires_at, network, token_contract, asset_symbol, decimals, recipient_address, amount_atomic, amount_minor, currency`,
        [id, buyerId, ref, packageRow.mode, packageRow.amount_minor, packageRow.currency, packageRow.ttl_seconds,
         packageRow.network, packageRow.token_contract, packageRow.asset_symbol, packageRow.decimals, packageRow.recipient_address, amountAtomic.toString()]);
      await c.query(
        `INSERT INTO ${this.s}.funding_intent_keys(buyer_id, client_id, idempotency_key, package_id, order_id)
         VALUES($1,$2,$3,$4,$5)`, [buyerId, p.clientId, key, packageId, id]);
      return { created: true, instructions: instructionsFromRow(inserted.rows[0]) };
    });
  }
}
