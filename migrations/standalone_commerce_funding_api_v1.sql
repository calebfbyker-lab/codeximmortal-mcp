BEGIN;
-- Agent-facing funding API increment: operator-configured deposit packages,
-- deposit-intent columns on funding_orders, and funding idempotency keys.
-- Packages ship inactive: enabling one is an owner decision (amount, network,
-- receiving address). This increment creates deposit intents only; it never
-- credits wallets, records payment, or trusts caller-supplied deposit evidence.
CREATE TABLE agent_commerce.funding_packages (
 id text PRIMARY KEY CHECK(id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'),
 network text NOT NULL CHECK(length(network) BETWEEN 1 AND 64),
 mode text NOT NULL CHECK(mode IN ('test','live')),
 token_contract text NOT NULL CHECK(token_contract ~ '^0x[0-9a-fA-F]{40}$'),
 asset_symbol text NOT NULL CHECK(asset_symbol ~ '^[A-Z]{2,10}$'),
 decimals integer NOT NULL CHECK(decimals BETWEEN 0 AND 18),
 recipient_address text NOT NULL CHECK(recipient_address ~ '^0x[0-9a-fA-F]{40}$'),
 amount_minor bigint NOT NULL CHECK(amount_minor > 0),
 currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 amount_atomic text NOT NULL CHECK(amount_atomic ~ '^[0-9]{1,78}$'),
 ttl_seconds integer NOT NULL DEFAULT 86400 CHECK(ttl_seconds BETWEEN 60 AND 2592000),
 max_open_intents integer NOT NULL DEFAULT 3 CHECK(max_open_intents BETWEEN 1 AND 100),
 active boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
COMMENT ON TABLE agent_commerce.funding_packages IS
 'Operator-configured deposit packages. Amounts, networks and receiving addresses are owner decisions; rows are inactive until the owner enables them.';
ALTER TABLE agent_commerce.funding_orders
 ADD COLUMN network text,
 ADD COLUMN token_contract text,
 ADD COLUMN asset_symbol text,
 ADD COLUMN decimals integer,
 ADD COLUMN recipient_address text,
 ADD COLUMN amount_atomic text;
COMMENT ON COLUMN agent_commerce.funding_orders.recipient_address IS
 'Snapshot of the package at intent creation; the deposit adapter must verify transfer network, contract, recipient, amount and finality before any credit.';
CREATE TABLE agent_commerce.funding_intent_keys (
 buyer_id uuid NOT NULL REFERENCES agent_commerce.buyers(id),
 client_id text NOT NULL,
 idempotency_key text NOT NULL CHECK(idempotency_key ~ '^[A-Za-z0-9_-]{16,128}$'),
 package_id text NOT NULL,
 order_id uuid NOT NULL REFERENCES agent_commerce.funding_orders(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(buyer_id, client_id, idempotency_key)
);
COMMENT ON TABLE agent_commerce.funding_intent_keys IS
 'Idempotency for deposit-intent creation. Same key and package returns the original instructions; a different package under the same key is a conflict.';
COMMIT;
