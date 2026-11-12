import type { Pool } from "pg";
import { createHash } from "node:crypto";
import { ApiError } from "./api.js";
const LIMITS: Record<string, number> = { quote: 30, submit: 10, job: 120, result: 120 };
export function postgresLimiter(pool: Pool) {
  return async (buyerId: string, clientId: string, operation: string) => {
    if (!Object.hasOwn(LIMITS, operation)) throw new ApiError(400, "unknown_operation");
    const limit = LIMITS[operation];
    const keys = [JSON.stringify(["buyer", buyerId, operation]), JSON.stringify(["client", clientId, operation])].map(v => createHash("sha256").update(v).digest("hex")).sort();
    let client;
    try {
      client = await pool.connect();
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout = '2000ms'");
      await client.query("SET LOCAL lock_timeout = '1000ms'");
      const clock = await client.query<{ window_id: string; retry_after: number }>("WITH t AS (SELECT floor(extract(epoch FROM statement_timestamp()))::bigint AS seconds) SELECT (seconds/60)::text AS window_id, (60-mod(seconds,60))::int AS retry_after FROM t");
      const { window_id, retry_after } = clock.rows[0];
      for (const key of keys) {
        const result = await client.query(`INSERT INTO agent_commerce_guard.rate_windows AS w (identity_hash, window_id, hits) VALUES ($1,$2,1) ON CONFLICT (identity_hash, window_id) DO UPDATE SET hits=w.hits+1 WHERE w.hits < $3 RETURNING hits`, [key, window_id, limit]);
        if (result.rowCount !== 1) { await client.query("ROLLBACK"); return { allowed: false, retryAfter: retry_after }; }
      }
      await client.query("COMMIT");
      return { allowed: true, retryAfter: 0 };
    } catch {
      if (client) await client.query("ROLLBACK").catch(() => undefined);
      throw new ApiError(503, "rate_limit_unavailable");
    } finally { client?.release(); }
  };
}
