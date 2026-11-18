CREATE SCHEMA IF NOT EXISTS owner_control;
CREATE TABLE owner_control.dispatch_policy (
  owner_id text PRIMARY KEY, paused boolean NOT NULL DEFAULT true
);
CREATE TABLE owner_control.tasks (
  id uuid PRIMARY KEY, owner_id text NOT NULL REFERENCES owner_control.dispatch_policy(owner_id),
  command_key uuid NOT NULL, objective text NOT NULL CHECK (length(objective) BETWEEN 1 AND 400),
  baseline_revision text NOT NULL CHECK (baseline_revision ~ '^[a-f0-9]{40}$'),
  policy_version integer NOT NULL DEFAULT 1 CHECK (policy_version=1),
  state text NOT NULL DEFAULT 'proposed' CHECK (state IN
    ('proposed','queued','running','awaiting_verification','verified','rejected','failed','cancelled')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  lease_token uuid, lease_until timestamptz, worker_id text, verifier_id text,
  result jsonb, error_code text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(owner_id,command_key), UNIQUE(owner_id,id),
  CHECK ((state='running') = (lease_until IS NOT NULL)),
  CHECK (state NOT IN ('awaiting_verification','verified','rejected') OR result IS NOT NULL),
  CHECK (state NOT IN ('verified','rejected') OR
    (verifier_id IS NOT NULL AND worker_id IS NOT NULL AND verifier_id<>worker_id))
);
CREATE INDEX owner_tasks_claim ON owner_control.tasks(owner_id,created_at,id)
  WHERE state IN ('queued','running');
CREATE TABLE owner_control.task_events (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id text NOT NULL REFERENCES owner_control.dispatch_policy(owner_id),
  task_id uuid, event_type text NOT NULL, actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(owner_id,task_id) REFERENCES owner_control.tasks(owner_id,id)
);
