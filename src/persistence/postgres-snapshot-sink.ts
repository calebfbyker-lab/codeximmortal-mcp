import type { Pool } from "pg";
import { identifier } from "../agent-services/contracts.js";
import type { Snapshot } from "../agent-services/contracts.js";
import type { SnapshotProvenance, SnapshotSink } from "../agent-services/snapshot-provider.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class SnapshotSinkError extends Error {
  constructor() {
    super("snapshot_sink_failed");
    this.name = "SnapshotSinkError";
  }
}

/**
 * Durable snapshot persistence. Inserts are idempotent per (buyer, snapshot):
 * worker retries under the same jobId re-persist the same snapshot without
 * duplicating rows. The payload always comes from the validated Snapshot.
 */
export class PostgresSnapshotSink implements SnapshotSink {
  constructor(private readonly pool: Pick<Pool, "connect">) {}

  async persist(snapshot: Snapshot, buyerId: string, provenance: SnapshotProvenance): Promise<void> {
    if (!UUID.test(buyerId)) throw new SnapshotSinkError();
    let identifierOk = true;
    try { identifier(snapshot.id); identifier(provenance.sourceId); }
    catch { identifierOk = false; }
    if (!identifierOk
      || !/^[a-f0-9]{64}$/.test(provenance.contentSha256)
      || !Number.isSafeInteger(provenance.fetchBytes) || provenance.fetchBytes < 0
      || !Number.isSafeInteger(provenance.extractedPlans) || provenance.extractedPlans < 0
      || provenance.rawContentType.length < 1 || provenance.rawContentType.length > 128) {
      throw new SnapshotSinkError();
    }
    const client = await this.pool.connect().catch(() => { throw new SnapshotSinkError(); });
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO as_snapshots (buyer_id, id, payload, complete_coverage_verified)
         VALUES ($1::uuid, $2, $3::jsonb, $4)
         ON CONFLICT (buyer_id, id) DO NOTHING`,
        [buyerId, snapshot.id, JSON.stringify(snapshot), snapshot.coverage === "complete"],
      );
      await client.query(
        `INSERT INTO as_snapshot_provenance
           (buyer_id, snapshot_id, source_id, content_sha256, fetch_bytes, extracted_plans, raw_content_type)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (buyer_id, snapshot_id) DO NOTHING`,
        [buyerId, snapshot.id, provenance.sourceId, provenance.contentSha256,
          provenance.fetchBytes, provenance.extractedPlans, provenance.rawContentType],
      );
      await client.query("COMMIT");
    } catch {
      await client.query("ROLLBACK").catch(() => undefined);
      throw new SnapshotSinkError();
    } finally {
      client.release();
    }
  }
}
