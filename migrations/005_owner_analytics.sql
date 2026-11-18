CREATE TABLE IF NOT EXISTS owner_control.owner_revenue_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  event_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('charge','refund','fee','other')),
  occurred_at timestamptz NOT NULL,
  gross_minor bigint NOT NULL,
  net_minor bigint NOT NULL,
  currency text NOT NULL,
  description text NOT NULL DEFAULT '',
  UNIQUE (source, event_id)
);
CREATE INDEX IF NOT EXISTS owner_revenue_events_occurred_at_idx
  ON owner_control.owner_revenue_events (occurred_at DESC);
CREATE TABLE IF NOT EXISTS owner_control.owner_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  name text NOT NULL,
  stage text NOT NULL DEFAULT 'new' CHECK (stage IN ('new','qualified','engaged','won','lost')),
  value_minor bigint NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS owner_leads_stage_idx ON owner_control.owner_leads (stage);
