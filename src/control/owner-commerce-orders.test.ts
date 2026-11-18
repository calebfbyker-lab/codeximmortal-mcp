import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { CommerceOrdersError, PostgresOwnerCommerceOrders } from './owner-commerce-orders.js';

function fixture(rows: Record<string, unknown>[] = []) {
  const query = vi.fn().mockResolvedValue({ rows });
  const store = new PostgresOwnerCommerceOrders({ query } as unknown as Pick<Pool, 'query'>);
  return { query, store };
}

describe('owner commerce order projection contract', () => {
  it('uses bounded parameterized reads and no financial mutation', async () => {
    const { store, query } = fixture();
    expect(await store.list(20)).toEqual({ ordering: 'job_id_desc', orders: [] });
    const [sql, values] = query.mock.calls[0]!;
    expect(values).toEqual([20]);
    expect(sql).toContain('LIMIT $1');
    expect(sql).toContain('LEFT JOIN');
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER)\b/i);
  });

  it.each([0, -1, 101, 1.5, NaN, Infinity])('rejects invalid limit %s before querying', async limit => {
    const { store, query } = fixture();
    await expect(store.list(limit)).rejects.toThrow('invalid_order_limit');
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects unsafe schema identifiers', () => {
    const { query } = fixture();
    expect(() => new PostgresOwnerCommerceOrders({ query } as unknown as Pick<Pool, 'query'>, 'bad;schema')).toThrow('invalid_commerce_schema');
  });

  it('preserves integer amounts as strings and omits sensitive fields', async () => {
    const { store } = fixture([{
      jobId: 'job', buyerId: 'buyer', clientId: 'client', service: 'pricing_compare',
      quoteId: 'quote', status: 'queued', amountMinor: '9007199254740993', currency: 'USD',
      reservationState: 'held', receiptId: null, input: 'private', token: 'secret',
    }]);
    const { orders } = await store.list();
    expect(orders[0]).toMatchObject({ amountMinor: '9007199254740993', receiptId: null,
      attribution: 'unknown', paymentEvidence: 'not_evaluated', reconciliation: 'not_evaluated' });
    expect(orders[0]).not.toHaveProperty('input');
    expect(orders[0]).not.toHaveProperty('token');
  });

  it('sanitizes database errors', async () => {
    const { store, query } = fixture();
    query.mockRejectedValueOnce(new Error('postgres://private-credentials'));
    await expect(store.list()).rejects.toThrow(CommerceOrdersError);
    query.mockRejectedValueOnce(new Error('postgres://private-credentials'));
    await expect(store.list()).rejects.toThrow('commerce_orders_unavailable');
  });
});
