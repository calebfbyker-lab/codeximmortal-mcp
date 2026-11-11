-- Apply once inside a migration transaction in the selected schema.
-- This increment stores snapshots only; it is not a credit or jobs ledger.
CREATE TABLE as_buyers (
  id uuid PRIMARY KEY,
  issuer text NOT NULL CHECK (length(issuer) BETWEEN 1 AND 2048),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 512),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (issuer, subject)
);

CREATE TABLE as_snapshots (
  buyer_id uuid NOT NULL REFERENCES as_buyers(id) ON DELETE RESTRICT,
  id text NOT NULL CHECK (id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'),
  payload jsonb NOT NULL,
  complete_coverage_verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (buyer_id, id),
  CHECK (jsonb_typeof(payload) = 'object'),
  CHECK (payload ? 'id' AND jsonb_typeof(payload->'id') = 'string'
         AND payload->>'id' = id),
  CHECK (NOT complete_coverage_verified OR
    ((payload->>'coverage' = 'complete') IS TRUE
     AND jsonb_typeof(payload->'plans') = 'array'
     AND CASE WHEN jsonb_typeof(payload->'plans') = 'array'
              THEN jsonb_array_length(payload->'plans') > 0 ELSE false END))
);

COMMENT ON COLUMN as_snapshots.complete_coverage_verified IS
  'Trusted ingestion metadata, not a buyer-supplied completeness claim.';
