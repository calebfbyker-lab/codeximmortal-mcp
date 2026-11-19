BEGIN;
CREATE SCHEMA growth_runtime;
-- One operator per schema. No agents have commercial execution authority.
CREATE TABLE growth_runtime.policy (singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), paused boolean NOT NULL DEFAULT true);
INSERT INTO growth_runtime.policy(singleton) VALUES(true);
CREATE TABLE growth_runtime.runs (
 id uuid PRIMARY KEY, command_key uuid NOT NULL UNIQUE,
 role text NOT NULL CHECK(role IN ('acquisition','conversion','pricing','code_evolution')),
 input jsonb NOT NULL, output jsonb,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','verified','failed')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 token uuid, worker text, lease_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((state='running')=(token IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE INDEX ON growth_runtime.runs(state,created_at);
CREATE TABLE growth_runtime.events (
 sequence bigserial PRIMARY KEY, run_id uuid REFERENCES growth_runtime.runs(id),
 kind text NOT NULL, actor text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
COMMIT;
