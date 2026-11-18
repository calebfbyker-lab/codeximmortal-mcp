BEGIN;
-- Crypto deposit adapter increment. Attribution: every pending crypto intent
-- holds a unique amount_atomic on its network, so one verified on-chain
-- transfer amount attributes to at most one intent. Receiving addresses remain
-- watch-only; custody never enters this repository.
ALTER TABLE agent_commerce.funding_packages
 ADD COLUMN atomic_uniqueness integer NOT NULL DEFAULT 10000
   CHECK(atomic_uniqueness BETWEEN 1 AND 100000);
COMMENT ON COLUMN agent_commerce.funding_packages.atomic_uniqueness IS
 'Number of unique deposit amounts above the package base amount. For USDC (6 decimals) with USD minor units, 10000 keeps minted amounts within one cent of the package price.';
CREATE UNIQUE INDEX funding_orders_pending_atomic_unique
  ON agent_commerce.funding_orders(network, amount_atomic)
  WHERE provider = 'crypto' AND status = 'pending';
COMMENT ON INDEX agent_commerce.funding_orders_pending_atomic_unique IS
 'One pending crypto intent per deposit amount per network. Expired-but-pending intents retain their slot in v1; slots are released only by finalization.';
CREATE TABLE agent_commerce.funding_scan_cursors (
 scan_key text PRIMARY KEY,
 network text NOT NULL CHECK(length(network) BETWEEN 1 AND 64),
 last_block bigint NOT NULL CHECK(last_block >= 0),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
COMMENT ON TABLE agent_commerce.funding_scan_cursors IS
 'Per (network, token, recipient) scan cursor. The deposit worker advances a cursor only after every log in the scanned range settled or was safely skipped.';
COMMIT;
