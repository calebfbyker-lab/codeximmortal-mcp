# Standalone commerce v1: admission milestone

Owner direction: standalone authority for pricing_snapshot, pricing_compare and
 document_extract. This supersedes docs/buyer-job-authority.md and its Base44
backend proposal FOR THESE THREE SERVICES ONLY. No existing Base44 balances or
buyers are imported. Legacy adapter source/tests remain unused by the runtime.

Status: UNCERTIFIED. Code authored, not compiled or executed in authoring environment.
No Stripe funding/webhooks, refunds, disputes, worker leases, settlement or recovery
are implemented here. No production activation, price publication or CI registration.
Do NOT enable production admission: admitted jobs would remain reserved and queued
until a separately verified settlement worker exists.

## Database and authority
Apply migrations/standalone_commerce_v1.sql once with a migration-owner role in a
reviewed, backed-up database. It creates a NEW schema and is intentionally not a
CREATE IF NOT EXISTS pseudo-upgrade. It fails instead of silently accepting drift.
The runtime never runs DDL. Supply a separate least-privilege application role.
Do not run destructive rollback against real financial records.

New acyclic local buyer/delegation identities are the commerce authority. Existing
as_buyers/as_snapshots persistence is NOT automatically bridged: provider integration
must scope snapshots consistently before comparison is live. The resources table
is only an ownership/admission index, not document storage or extraction validation.
No self-registration, delegation editing or production funding API is provided.
Amounts are positive integer minor units; one currency per buyer; delegation limits
are lifetime spent+reserved, not a daily allowance. Budget and job-limit locks are
serialized per buyer for correctness in this initial implementation.

Admission rechecks active buyer/delegation, token+DB scopes, allowed service,
quote ownership/input/currency/expiry, one-use quote, ownership index, open-job cap,
delegated spending cap and funded capacity. Locks precede the replay lookup;
identical replay returns original job even after quote expiry. Changed digest is 409.
Wallet transfer, delegation reservation, job/idempotency key, reservation, journal and
outbox commit together or roll back. No automatic submit retry; after an ambiguous
commit, reuse the original key and exact input. Successful replay still requires an
active delegation and permission. Live price edits do not rewrite an unexpired quote;
disabling the service blocks new admissions. Price-version change semantics are
therefore quote-honoring until expiry, subject to the live kill switch.
The ledger is a transaction journal, not yet a complete double-entry accounting system.
No append-only DB role policy is installed; production hardening remains a gate.

## Runtime (leave disabled)
AGENT_COMMERCE_ENABLED defaults false. To use an isolated development deployment,
review and set AGENT_COMMERCE_AUTHORITY_CONTRACT=postgres-commerce-v1-reviewed,
AGENT_COMMERCE_DATABASE_URL and the existing AGENT_AUTH_* introspection settings.
No Base44 URL/token is read or called by this runtime.
Existing agent_commerce_guard.rate_windows migration is still required for limiter.
The database flag is configuration, not evidence of readiness. /healthz is liveness,
not commerce readiness. MCP wire identity/dispatcher integration remains outstanding.

## Verification (real disposable PostgreSQL only)
Use TEST_DATABASE_URL plus CODEX_DB_TEST_ACK=disposable-database-only and
REQUIRE_DB_TESTS=true. No URL means skipped; required mode without URL fails.
Tests create only a random commerce_test_* schema, then drop that own schema.
Synthetic wallet entries are test fixtures, never a grant mechanism.

npm run build
npm test -- src/agent-commerce/postgres-commerce.integration.test.ts
npm test

Existing npm run test:db still targets only snapshot tests; invoke the new suite
explicitly as above until CI coverage is deliberately expanded. No passing test,
remote CI, migration, deployment, Stripe action or payment status is claimed here.
