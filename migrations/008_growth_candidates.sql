BEGIN;
CREATE TABLE growth_runtime.candidates (
 id uuid PRIMARY KEY,
 model text NOT NULL CHECK (model ~ '^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$' AND model !~* 'cloud'),
 objective text NOT NULL CHECK (length(objective) BETWEEN 1 AND 2000),
 context_digest text NOT NULL CHECK (context_digest ~ '^[a-f0-9]{64}$'),
 plan jsonb NOT NULL,
 status text NOT NULL DEFAULT 'unreviewed' CHECK (status IN ('unreviewed','accepted','rejected','superseded')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE (model, objective, context_digest)
);
CREATE INDEX ON growth_runtime.candidates (created_at DESC);
COMMIT;
