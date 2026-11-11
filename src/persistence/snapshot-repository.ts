import type { Snapshot } from "../agent-services/contracts.js";

export interface StoredSnapshot {
  readonly buyerId: string;
  readonly snapshot: Snapshot;
  readonly completeCoverageVerified: boolean;
}

export interface OwnedSnapshotPair {
  readonly before: StoredSnapshot;
  readonly after: StoredSnapshot;
}

export interface SnapshotRepository {
  findOwnedPair(
    buyerId: string,
    beforeSnapshotId: string,
    afterSnapshotId: string,
  ): Promise<OwnedSnapshotPair | null>;
}
