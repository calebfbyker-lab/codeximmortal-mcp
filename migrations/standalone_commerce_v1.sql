BEGIN;
CREATE SCHEMA agent_commerce;
CREATE TABLE agent_commerce.buyers (
 id uuid PRIMARY KEY, issuer text NOT NULL, subject text NOT NULL,
 active boolean NOT NULL DEFAULT false, currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 UNIQUE(issuer,subject)
);
CREATE TABLE agent_commerce.delegations (
 buyer_id uuid NOT NULL REFERENCES agent_commerce.buyers(id), client_id text NOT NULL,
 active boolean NOT NULL DEFAULT false, expires_at timestamptz NOT NULL,
 scopes text[] NOT NULL DEFAULT '{}', services text[] NOT NULL DEFAULT '{}',
 limit_minor bigint NOT NULL CHECK(limit_minor>=0),
 reserved_minor bigint NOT NULL DEFAULT 0 CHECK(reserved_minor>=0),
 spent_minor bigint NOT NULL DEFAULT 0 CHECK(spent_minor>=0),
 max_open_jobs integer NOT NULL CHECK(max_open_jobs BETWEEN 1 AND 100),
 PRIMARY KEY(buyer_id,client_id), CHECK(reserved_minor+spent_minor<=limit_minor)
);
CREATE TABLE agent_commerce.wallets (
 buyer_id uuid PRIMARY KEY REFERENCES agent_commerce.buyers(id),
 available_minor bigint NOT NULL DEFAULT 0 CHECK(available_minor>=0),
 held_minor bigint NOT NULL DEFAULT 0 CHECK(held_minor>=0)
);
CREATE TABLE agent_commerce.prices (
 service text PRIMARY KEY CHECK(service IN ('pricing_snapshot','pricing_compare','document_extract')),
 version text NOT NULL, currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 amount_minor integer NOT NULL CHECK(amount_minor>0), enabled boolean NOT NULL DEFAULT false
);
-- Owned resource admission index; provider must also check actual source ownership/content.
CREATE TABLE agent_commerce.resources (
 buyer_id uuid NOT NULL REFERENCES agent_commerce.buyers(id),
 kind text NOT NULL CHECK(kind IN ('source','snapshot','document')), id text NOT NULL,
 ready boolean NOT NULL DEFAULT false, PRIMARY KEY(buyer_id,kind,id)
);
CREATE TABLE agent_commerce.quotes (
 id text PRIMARY KEY, buyer_id uuid NOT NULL, client_id text NOT NULL,
 service text NOT NULL REFERENCES agent_commerce.prices(service),
 input jsonb NOT NULL, input_digest text NOT NULL CHECK(input_digest ~ '^[a-f0-9]{64}$'),
 price_version text NOT NULL, currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 amount_minor integer NOT NULL CHECK(amount_minor>0), expires_at timestamptz NOT NULL,
 FOREIGN KEY(buyer_id,client_id) REFERENCES agent_commerce.delegations(buyer_id,client_id)
);
CREATE TABLE agent_commerce.jobs (
 id text PRIMARY KEY, buyer_id uuid NOT NULL, client_id text NOT NULL,
 service text NOT NULL, input jsonb NOT NULL, quote_id text NOT NULL UNIQUE REFERENCES agent_commerce.quotes(id),
 idempotency_key text NOT NULL CHECK(idempotency_key ~ '^[A-Za-z0-9_-]{16,128}$'),
 request_digest text NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'),
 amount_minor integer NOT NULL CHECK(amount_minor>0), currency text NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','succeeded','failed')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(buyer_id,client_id,idempotency_key),
 FOREIGN KEY(buyer_id,client_id) REFERENCES agent_commerce.delegations(buyer_id,client_id)
);
CREATE INDEX ON agent_commerce.jobs(buyer_id,client_id,status);
CREATE TABLE agent_commerce.reservations (
 job_id text PRIMARY KEY REFERENCES agent_commerce.jobs(id),
 state text NOT NULL DEFAULT 'held' CHECK(state IN ('held','consumed','released')),
 amount_minor integer NOT NULL CHECK(amount_minor>0)
);
CREATE TABLE agent_commerce.ledger (
 id bigserial PRIMARY KEY, buyer_id uuid NOT NULL REFERENCES agent_commerce.buyers(id),
 job_id text REFERENCES agent_commerce.jobs(id),
 kind text NOT NULL CHECK(kind IN ('fund','reserve','consume','release','refund','dispute')),
 available_delta bigint NOT NULL, held_delta bigint NOT NULL,
 external_ref text UNIQUE, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(job_id,kind), CHECK(job_id IS NOT NULL OR external_ref IS NOT NULL)
);
CREATE TABLE agent_commerce.outbox (
 job_id text PRIMARY KEY REFERENCES agent_commerce.jobs(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), delivered_at timestamptz
);
CREATE TABLE agent_commerce.results (
 job_id text PRIMARY KEY REFERENCES agent_commerce.jobs(id),
 value jsonb NOT NULL, receipt_id text NOT NULL UNIQUE
);
COMMENT ON SCHEMA agent_commerce IS 'Admission foundation only; no payment grants or settlement worker installed';
COMMIT;
