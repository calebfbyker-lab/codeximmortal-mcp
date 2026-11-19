# Growth PostgreSQL verification increment

Status: PROVISIONAL / UNCERTIFIED. Tests authored, not executed. No production changes, migration execution, activation or deployment is included.

## Recorded evidence
2026-11-19, user-reported local runs (not remote CI): vitest 2.1.9. Targeted `npx vitest run src/growth/agents.test.ts src/growth/runtime.integration.test.ts --maxWorkers=1 --minWorkers=1` -> 17 passed, 0 failed, 2.00s (integration file 821ms). Full regression `npx vitest run --maxWorkers=1 --minWorkers=1` -> 65 files, 531 tests, 0 failed, 40.13s, no worker-exit errors. npm run build output not recorded; PostgreSQL server version and exact checkout commit not recorded. Update this section when those details are captured.

## Safety
The suite requires TEST_DATABASE_URL with postgres/postgresql, a literal localhost/127.0.0.1/[::1] host, database /codex_test_disposable, no URL query or fragment, and CODEX_DB_TEST_ACK=disposable-database-only. REQUIRE_DB_TESTS=true rejects missing configuration. Without a URL the suite is skipped, not passed. Supply credentials through local environment secrets; never commit them.

A random growth_test_<uuid> schema receives the real migration. A test-only routing adapter replaces the growth_runtime schema identifier on real PostgreSQL queries and connected clients. It does not simulate query results, transactions, concurrency or failures. It never migrates or truncates the shared growth_runtime schema, commerce data or another suite schema. Teardown drops only its random schema and closes the pool; interrupted processes may leave an isolated test schema for manual inspection.

## Coverage
Eleven independent tests: paused migration default; absent-policy claim refusal; concurrent identical command deduplication; changed-input and changed-role idempotency conflicts; concurrent claim exclusion; live renewal and unrelated-token rejection; expired/replaced owner fencing; pause and resume; three-attempt exhaustion; once-only completion; event-insert failure rollback and retry. Tests use SQL lease expiry rather than wall-clock sleeps. Fault injection uses a real trigger rejecting completion events.

These tests demonstrate behavior only if executed successfully. They do not prove independent-agent verification, commercial truth, financial accounting, performance scaling, external side effects or a complete swarm. The singleton policy lock serializes claims; these tests assert exclusion, not throughput.

## Commands (PowerShell)
Set TEST_DATABASE_URL in your local secret environment to the disposable localhost database first.

```powershell
$env:CODEX_DB_TEST_ACK='disposable-database-only'
$env:REQUIRE_DB_TESTS='true'
npm run build
npx vitest run src/growth/agents.test.ts src/growth/runtime.integration.test.ts src/growth/growth-http.integration.test.ts --maxWorkers=1 --minWorkers=1
```

Record exact commit, database/server versions, command, completed/pass/fail/skip counts and all unhandled errors. After the targeted run succeeds, run the full regression suite with the same database guards. Database-unreachable results are failures, not skips. No worker-count setting is asserted to solve earlier unexplained worker exits.
