BEGIN;
-- Funding orders and a durable webhook/deposit event inbox. This increment
-- stores payment bindings and verified events only; it grants no authority to
-- create orders from request input and installs no payment adapters.
-- Credit settlement is a single transaction: inbox insert, binding checks,
-- wallet credit, fund ledger row, order and event finalization.
CREATE TABLE agent_commerce.funding_orders (
 id uuid PRIMARY KEY,
 buyer_id uuid NOT NULL REFERENCES agent_commerce.buyers(id),
 provider text NOT NULL CHECK(provider IN ('stripe','crypto')),
 provider_ref text NOT NULL CHECK(length(provider_ref) BETWEEN 1 AND 256),
 mode text NOT NULL CHECK(mode IN ('test','live')),
 amount_minor bigint NOT NULL CHECK(amount_minor > 0),
 currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','credited','cancelled')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,
 credited_at timestamptz,
 UNIQUE(provider, provider_ref)
);
CREATE INDEX ON agent_commerce.funding_orders(buyer_id, status);
COMMENT ON TABLE agent_commerce.funding_orders IS
 'Server-owned payment binding: one order per provider payment reference. Buyer identity comes from this binding, never from webhook or event metadata.';
CREATE TABLE agent_commerce.funding_events (
 id uuid PRIMARY KEY,
 provider text NOT NULL CHECK(provider IN ('stripe','crypto')),
 provider_event_id text NOT NULL CHECK(length(provider_event_id) BETWEEN 1 AND 256),
 provider_ref text NOT NULL CHECK(length(provider_ref) BETWEEN 1 AND 256),
 payload jsonb NOT NULL,
 status text NOT NULL DEFAULT 'received' CHECK(status IN ('received','settled','rejected')),
 error_code text,
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 settled_at timestamptz,
 UNIQUE(provider, provider_event_id)
);
COMMENT ON TABLE agent_commerce.funding_events IS
 'Durable inbox for verified payment-provider events. Rejections are recorded so poison deliveries do not loop; the raw payload is evidence, not authorization.';
COMMIT;
