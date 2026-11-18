import type { Pool } from "pg";
import { identifier } from "../agent-services/contracts.js";
import { validateSnapshot } from "../agent-services/pricing-snapshot.js";
import type { OwnedSnapshotPair, SnapshotRepository } from "./snapshot-repository.js";

interface PairRow {
  buyer_id: string;
  before_payload: unknown;
  after_payload: unknown;
  before_verified: boolean;
  after_verified: boolean;
}

export class SnapshotRepositoryError extends Error {
  constructor() {
    super("snapshot_repository_failed");
    this.name = "SnapshotRepositoryError";
  }
}

export class PostgresSnapshotRepository implements SnapshotRepository {
  constructor(private readonly pool: Pick<Pool, "query">) {}

  async findOwnedPair(
    buyerId: string,
    beforeSnapshotId: string,
    afterSnapshotId: string,
  ): Promise<OwnedSnapshotPair | null> {
    try {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(buyerId)) {
        throw new Error("invalid_buyer");
      }
      identifier(beforeSnapshotId);
      identifier(afterSnapshotId);

      // One statement observes a consistent pair. Both rows are buyer-scoped.
      const result = await this.pool.query<PairRow>(
        `SELECT b.buyer_id::text AS buyer_id,
                b.payload AS before_payload,
                a.payload AS after_payload,
                b.complete_coverage_verified AS before_verified,
                a.complete_coverage_verified AS after_verified
           FROM as_snapshots b
           JOIN as_snapshots a ON a.buyer_id = b.buyer_id
          WHERE b.buyer_id = $1::uuid AND a.buyer_id = $1::uuid
            AND b.id = $2 AND a.id = $3`,
        [buyerId, beforeSnapshotId, afterSnapshotId],
      );
      if (result.rows.length === 0) return null;
      if (result.rows.length !== 1) throw new Error("ambiguous_pair");
      const row = result.rows[0];
      if (row.buyer_id !== buyerId.toLowerCase()) throw new Error("owner_mismatch");
      const before = validateSnapshot(row.before_payload);
      const after = validateSnapshot(row.after_payload);
      if (before.id !== beforeSnapshotId || after.id !== afterSnapshotId) {
        throw new Error("snapshot_id_mismatch");
      }
      return {
        before: { buyerId: row.buyer_id, snapshot: before,
          completeCoverageVerified: row.before_verified === true },
        after: { buyerId: row.buyer_id, snapshot: after,
          completeCoverageVerified: row.after_verified === true },
      };
    } catch {
      // No SQL text, connection URL, payload, or driver exception escapes.
      throw new SnapshotRepositoryError();
    }
  }
}
