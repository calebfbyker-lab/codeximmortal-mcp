BEGIN;
ALTER TABLE agent_commerce.outbox
 ADD COLUMN lease_token uuid,
 ADD COLUMN lease_until timestamptz,
 ADD COLUMN available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 ADD COLUMN attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 ADD COLUMN max_attempts integer NOT NULL DEFAULT 3 CHECK(max_attempts BETWEEN 1 AND 10),
 ADD CONSTRAINT paired_lease CHECK((lease_token IS NULL)=(lease_until IS NULL));
CREATE INDEX ON agent_commerce.outbox(available_at,lease_until) WHERE delivered_at IS NULL;
CREATE TABLE agent_commerce.receipts (
 id text PRIMARY KEY, job_id text NOT NULL UNIQUE REFERENCES agent_commerce.jobs(id),
 outcome text NOT NULL CHECK(outcome IN ('succeeded','failed')),
 amount_minor integer NOT NULL CHECK(amount_minor>0), currency text NOT NULL,
 charged_minor integer NOT NULL CHECK(charged_minor>=0),
 error_code text CHECK(error_code IN ('provider_rejected','retry_exhausted')),
 result_digest text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((outcome='succeeded' AND charged_minor=amount_minor AND error_code IS NULL AND result_digest IS NOT NULL AND result_digest ~ '^[a-f0-9]{64}$') OR
       (outcome='failed' AND charged_minor=0 AND error_code IS NOT NULL AND result_digest IS NULL))
);
ALTER TABLE agent_commerce.results ADD CONSTRAINT result_receipt_fk FOREIGN KEY(receipt_id) REFERENCES agent_commerce.receipts(id);
COMMIT;
