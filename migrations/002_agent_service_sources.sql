-- Apply once inside a migration transaction in the selected schema,
-- AFTER 001_agent_service_snapshots.sql. Sources and provenance only;
-- no credit, jobs, or settlement state lives here.
CREATE TABLE as_sources (
  buyer_id uuid NOT NULL REFERENCES as_buyers(id) ON DELETE RESTRICT,
  source_id text NOT NULL CHECK (source_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'),
  url text NOT NULL CHECK (
    url ~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?(/.*)?$'
    AND url NOT LIKE '%@%'
    AND length(url) <= 2048),
  approved_for_capture boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (buyer_id, source_id)
);

COMMENT ON COLUMN as_sources.approved_for_capture IS
  'Owner-reviewed capture approval. The commerce admission resource index and buyer authorization are enforced separately.';

CREATE TABLE as_snapshot_provenance (
  buyer_id uuid NOT NULL,
  snapshot_id text NOT NULL,
  source_id text NOT NULL,
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  fetch_bytes bigint NOT NULL CHECK (fetch_bytes >= 0),
  extracted_plans integer NOT NULL CHECK (extracted_plans >= 0),
  raw_content_type text NOT NULL CHECK (length(raw_content_type) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (buyer_id, snapshot_id),
  FOREIGN KEY (buyer_id, snapshot_id)
    REFERENCES as_snapshots(buyer_id, id) ON DELETE CASCADE,
  FOREIGN KEY (buyer_id, source_id)
    REFERENCES as_sources(buyer_id, source_id) ON DELETE RESTRICT
);
