-- Apply explicitly after 005 in the dedicated owner-local database.
BEGIN;
CREATE TABLE owner_control.owner_lead_transition_events (
  command_id uuid PRIMARY KEY,
  lead_id uuid NOT NULL REFERENCES owner_control.owner_leads(id),
  actor text NOT NULL CHECK (length(actor) BETWEEN 1 AND 100),
  from_stage text NOT NULL CHECK (from_stage IN ('new','qualified','engaged','won','lost')),
  to_stage text NOT NULL CHECK (to_stage IN ('new','qualified','engaged','won','lost')),
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 400),
  policy_version integer NOT NULL CHECK (policy_version = 1),
  decision text NOT NULL CHECK (decision = 'approved'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (from_stage <> to_stage)
);
CREATE INDEX ON owner_control.owner_lead_transition_events (lead_id, created_at DESC);
COMMIT;
