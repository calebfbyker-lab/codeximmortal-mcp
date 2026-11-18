# Standalone PostgreSQL increment — review draft

This increment is planned and UNCERTIFIED. It replaces no existing checkout, buyer, entitlement, balance, job or result authority for existing products. For the three proposed standalone services, the new schema is isolated storage groundwork, not an active commercial authority. Base44, storefront, catalog, MCP manifest, dispatch, HTTP and prices are unchanged. docs/agent-services.md still contains historical Base44-authority language and requires a separately reviewed architecture update before standalone activation.

## Included
- Buyer issuer/subject mapping and tenant-composite snapshot primary key.
- Parameterized single-statement lookup of a buyer-owned pair.
- Validation of stored snapshot payloads and fixed repository failure messages.
- Twelve PostgreSQL integration cases using synthetic A/B fixtures in a unique schema.
- Separate Node 22/PostgreSQL 16 CI workflow; no Render or deployment change.
- package.json adds pg, @types/pg and test:db. Version ranges are proposed, not resolved/audited dependency evidence.

The prior application-handler examples were never committed. Only the repository interface needed by this increment is included here. There is no authentication middleware, write API, credit ledger, billing, job engine or tool registration in this increment.

## Database trust
buyerId is an internal UUID resolved by trusted authentication/application code, never an MCP argument. The repository can read any buyer when called with that UUID; it is not an auth verifier. Tests verify repository query isolation, NOT end-to-end authenticated isolation or release gate B completion.

Isolation here is explicit SQL predicates and scoped repository access, not PostgreSQL RLS. Before production use, provision a separate read-only runtime role, trusted writer role and migration owner; do not connect public handlers as database owner. Do not grant buyers direct SQL access. Completeness metadata is writable only by a trusted ingestion path; database shape checks cannot establish provenance. The verified flag is a trusted producer assertion, not a cryptographic proof.

Snapshots must be immutable to the runtime role. Define privileged retention/deletion policy and trust-revocation policy before rollout. The migration intentionally does not create cluster-wide roles, grants, RLS or billing structures. A single SQL SELECT gives a statement-consistent pair; future multistep writes need explicit transactions.

## Execution
Use Node >=22 and a dedicated disposable PostgreSQL database only. Tests create and drop a random schema inside the supplied database, including DROP SCHEMA ... CASCADE scoped to that generated schema. The acknowledgement variable is a human safety guard, not automatic verification that a database is nonproduction. Never use a production URL. TLS settings must be configured appropriately for the environment; do not disable certificate verification for a remote production database.

Install dependencies using repository policy, preserving any existing local lockfile. No tracked lockfile was present in the inspected remote root; an untracked local lockfile remains unknown. Do not automatically stage/overwrite it. A reviewed resolved lockfile and dependency audit remain required before release. test:db does not replace npm test or npm run build.

PowerShell:
  $env:TEST_DATABASE_URL = '<dedicated disposable PostgreSQL connection string>'
  $env:CODEX_DB_TEST_ACK = 'disposable-database-only'
  $env:REQUIRE_DB_TESTS = 'true'
  npm run test:db
  npm test
  npm run build

Without TEST_DATABASE_URL the DB suite is explicitly skipped. With REQUIRE_DB_TESTS=true and no URL it fails immediately. A skipped suite is never database PASS evidence. The included workflow sets both variables and uses a disposable service database. The workflow credentials are public synthetic fixtures, not production secrets. Migration application in tests is transactional in the isolated schema; production migration orchestration/version tracking is not provided here.

Record commit/patch hash, Node/PostgreSQL/resolved dependency versions, timestamp, command, each case, expected/observed outcomes, redacted output and PASS/FAIL/INCONCLUSIVE. Do not publish connection strings or driver exceptions. Compilation, Vitest and PostgreSQL execution were not run in the artifact-generation environment.

## Scope and next work
No changes to existing workflow, manifests, pricing or entitlements. No CI number assigned. HUMAN GATE required before activation/advertising. AX-01/AX-02/AX-04 and release gates A-G remain blocking. Next: execute in CI, review evidence, implement verified buyer-context integration and least-privilege database provisioning. Then durable jobs/reservations/settlement, followed by worker fetching/parsing.
