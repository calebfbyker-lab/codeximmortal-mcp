-- Operator-reviewed setup; not applied automatically. Security metadata only.
CREATE SCHEMA IF NOT EXISTS agent_commerce_guard;
CREATE TABLE IF NOT EXISTS agent_commerce_guard.rate_windows (
  identity_hash text NOT NULL CHECK (identity_hash ~ '^[0-9a-f]{64}$'),
  window_id bigint NOT NULL,
  hits integer NOT NULL CHECK (hits > 0),
  PRIMARY KEY (identity_hash, window_id)
);
CREATE INDEX IF NOT EXISTS agent_rate_windows_cleanup_idx ON agent_commerce_guard.rate_windows(window_id);
-- Provision a separate non-owner runtime role with schema USAGE and table
-- SELECT/INSERT/UPDATE only. Runtime must not have DDL or DELETE privileges.
-- Schedule privileged cleanup of windows older than 24h:
-- DELETE FROM agent_commerce_guard.rate_windows
-- WHERE window_id < floor(extract(epoch FROM now())/60)::bigint - 1440;
