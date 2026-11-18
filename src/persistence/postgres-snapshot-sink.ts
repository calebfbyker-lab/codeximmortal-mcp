import type { Pool } from "pg";
import { canonicalJson, identifier, type Snapshot } from "../agent-services/contracts.js";
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
 * duplicating rows. On conflict the persisted payload and provenance are read
 * back within the same transaction and must agree exactly with the retry —
 * a silent keep-old would let a retry report success while the stored row
 * differs from the payload the caller received. Any disagreement fails the
 * transaction and surfaces as a sink error.
 *
 * A snapshot claiming complete coverage is cross-checked against its own plan
 * data before the claim is persisted as verified: every plan must carry a
 * parsed amount. This makes the stored flag internally consistent with the
 * payload; it does NOT prove the capture saw every plan the source offers —
 * that stronger guarantee requires independent verification (second capture
 * or buyer attestation) and is tracked as an open production prerequisite.
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
    if (snapshot.coverage === "complete"
      && (snapshot.plans.length === 0 || snapshot.plans.some(plan => plan.amount === null))) {
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
      const stored = await client.query(
        "SELECT payload FROM as_snapshots WHERE buyer_id = $1::uuid AND id = $2",
        [buyerId, snapshot.id],
      );
      if (stored.rowCount !== 1 || canonicalJson(stored.rows[0]?.payload) !== canonicalJson(snapshot)) {
        throw new SnapshotSinkError();
      }
      await client.query(
        `INSERT INTO as_snapshot_provenance
           (buyer_id, snapshot_id, source_id, content_sha256, fetch_bytes, extracted_plans, raw_content_type)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (buyer_id, snapshot_id) DO NOTHING`,
        [buyerId, snapshot.id, provenance.sourceId, provenance.contentSha256,
          provenance.fetchBytes, provenance.extractedPlans, provenance.rawContentType],
      );
      const storedProvenance = await client.query(
        "SELECT source_id, content_sha256, fetch_bytes, extracted_plans, raw_content_type FROM as_snapshot_provenance WHERE buyer_id = $1::uuid AND snapshot_id = $2",
        [buyerId, snapshot.id],
      );
      const row = storedProvenance.rows[0];
      if (storedProvenance.rowCount !== 1 || !row
        || row.source_id !== provenance.sourceId
        || row.content_sha256 !== provenance.contentSha256
        || String(row.fetch_bytes) !== String(provenance.fetchBytes)
        || row.extracted_plans !== provenance.extractedPlans
        || row.raw_content_type !== provenance.rawContentType) {
        throw new SnapshotSinkError();
      }
      await client.query("COMMIT");
    } catch {
      await client.query("ROLLBACK").catch(() => undefined);
      throw new SnapshotSinkError();
    } finally {
      client.release();
    }
  }
}
