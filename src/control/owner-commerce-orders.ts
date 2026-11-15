import type { Pool } from 'pg';

export class CommerceOrdersError extends Error {
  constructor() { super('commerce_orders_unavailable'); this.name = 'CommerceOrdersError'; }
}

/** Owner-only read model. Mount only behind existing owner authentication.
 * No wallet writes, provider calls, buyer tokens, input payloads or results.
 * A reservation is not proof of payment; a receipt reference is not reconciliation.
 */
export class PostgresOwnerCommerceOrders {
  private readonly schema: string;
  constructor(private readonly pool: Pick<Pool, 'query'>, schema = 'agent_commerce') {
    if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) throw new Error('invalid_commerce_schema');
    this.schema = `"${schema}"`;
  }

  async list(limit = 50) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('invalid_order_limit');
    const result = await this.pool.query(
      `SELECT j.id AS "jobId", j.buyer_id AS "buyerId", j.client_id AS "clientId",
        j.service, j.quote_id AS "quoteId", j.status,
        j.amount_minor::text AS "amountMinor", j.currency,
        h.state AS "reservationState", r.receipt_id AS "receiptId"
       FROM ${this.schema}.jobs j
       LEFT JOIN ${this.schema}.reservations h ON h.job_id = j.id
       LEFT JOIN ${this.schema}.results r ON r.job_id = j.id
       ORDER BY j.id DESC LIMIT $1`, [limit],
    ).catch(() => { throw new CommerceOrdersError(); });
    return {
      // UUID order is deterministic, not chronological. No recency claim.
      ordering: 'job_id_desc' as const,
      orders: result.rows.map((row: Record<string, unknown>) => ({
        jobId: String(row.jobId), buyerId: String(row.buyerId), clientId: String(row.clientId),
        service: String(row.service), quoteId: String(row.quoteId), status: String(row.status),
        amountMinor: String(row.amountMinor), currency: String(row.currency),
        reservationState: row.reservationState == null ? null : String(row.reservationState),
        receiptId: row.receiptId == null ? null : String(row.receiptId),
        attribution: 'unknown' as const,
        paymentEvidence: 'not_evaluated' as const,
        reconciliation: 'not_evaluated' as const,
      })),
    };
  }
}
