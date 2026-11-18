CREATE TABLE owner_control.policy_documents (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL REFERENCES owner_control.dispatch_policy(owner_id),
  kind text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  document_sha256 char(64) NOT NULL,
  document jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  superseded_by uuid REFERENCES owner_control.policy_documents(id),
  UNIQUE (owner_id, kind, version)
);
CREATE TABLE owner_control.approvals (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL REFERENCES owner_control.dispatch_policy(owner_id),
  task_id uuid,
  policy_kind text NOT NULL,
  policy_version integer NOT NULL,
  action text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approved','denied')),
  decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (owner_id, task_id) REFERENCES owner_control.tasks(owner_id, id),
  UNIQUE (owner_id, task_id, action, policy_version)
);
CREATE TABLE owner_control.governance_events (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id text NOT NULL REFERENCES owner_control.dispatch_policy(owner_id),
  actor text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  prev_entry_sha256 char(64),
  entry_sha256 char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX owner_governance_events_owner ON owner_control.governance_events(owner_id, sequence DESC);
CREATE TABLE owner_control.agent_registrations (
  owner_id text NOT NULL REFERENCES owner_control.dispatch_policy(owner_id),
  agent_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('worker','verifier')),
  first_seen timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_heartbeat timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_task_id uuid,
  PRIMARY KEY (owner_id, agent_id)
);
