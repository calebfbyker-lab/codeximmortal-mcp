import type { Pool } from "pg";
import { identifier } from "../agent-services/contracts.js";
import type { SnapshotSourceStore, SourceRecord } from "../agent-services/snapshot-provider.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class SnapshotSourceStoreError extends Error {
  constructor() {
    super("snapshot_source_store_failed");
    this.name = "SnapshotSourceStoreError";
  }
}

export class PostgresSnapshotSourceStore implements SnapshotSourceStore {
  constructor(private readonly pool: Pick<Pool, "query">) {}

  async findOwnedSource(buyerId: string, sourceId: string): Promise<SourceRecord | null> {
    try {
      if (!UUID.test(buyerId)) throw new Error("invalid_buyer");
      identifier(sourceId);
      const result = await this.pool.query<{
        buyer_id: string; source_id: string; url: string; approved_for_capture: boolean;
      }>(
        `SELECT buyer_id::text AS buyer_id, source_id, url, approved_for_capture
           FROM as_sources
          WHERE buyer_id = $1::uuid AND source_id = $2 AND approved_for_capture`,
        [buyerId, sourceId],
      );
      if (result.rows.length === 0) return null;
      const row = result.rows[0];
      if (row.buyer_id !== buyerId.toLowerCase() || row.approved_for_capture !== true) return null;
      return {
        buyerId: row.buyer_id, sourceId: row.source_id,
        url: row.url, approvedForCapture: true,
      };
    } catch {
      // No SQL text, connection details, or driver exceptions escape.
      throw new SnapshotSourceStoreError();
    }
  }
}
