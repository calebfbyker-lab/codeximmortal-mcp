# Durable worker milestone
Status: UNCERTIFIED. New code not compiled or tested in authoring environment.
Baseline: d636003cb21749928b09e184ac354c3176ba8635. No deployment, funding,
migration execution, price publication or production activation performed.

Apply standalone_commerce_v1.sql BEFORE standalone_commerce_worker_v1.sql using a
migration owner; both are one-time migrations. Runtime runs no DDL. Back up real
records, review privileges, and never drop real financial schemas to retry a migration.

DurableWorker(pool, providers) provides claim/renew/defer/finish/runOnce/run(signal).
Library composition is opt-in; HTTP runtime does NOT start a worker. Real Providers
wiring is still required. executeService receives jobId, attempt and AbortSignal.
Providers must enforce ownership/provenance; the resource index is not sufficient.
Comparison still makes two provider reads; consistent-pair integration is outstanding.

Lock order: buyer, delegation, job, outbox, reservation, wallet. Parallel claims skip
locked buyers. Random lease tokens fence renewal and settlement. Provider IO runs
outside transactions. Heartbeats renew live leases. Timeout=min(30s,half lease).
Unknown/time-out failures retry with bounded backoff; explicit input/access errors
and invalid_provider_output terminate. Exhaustion releases holds, including expired
crash leases. Pre-claim revocation cancels; post-start revocation is not retroactive.
Success atomically consumes held funds, moves delegated reserved to spent, persists
result/receipt/hash, journals consumption and completes job/outbox. Terminal failure
releases capacity, creates zero-charge receipt and journals release. Retry retains
hold. Duplicate completion is a no-op; old tokens cannot settle a re-leased job.
Receipt amounts/currency come from stored job, never provider output.

At-least-once execution, NOT exactly-once external effects: crashes/timeouts may
repeat provider calls. Cancellation is advisory; providers must honor signal and
use stable jobId where external deduplication is supported. Cost policy must account
for retries. Shutdown bounds/finishes an active iteration, not instant cancellation.

Remaining: Stripe grants/webhooks/refunds/disputes; append-only least-privilege
ledger policy; real providers/intake; snapshot identity bridge; MCP authenticated
dispatch; readiness and process lifecycle. Failure receipts are internal only;
success result includes receiptId, but no receipt retrieval endpoint exists yet.

With disposable TEST_DATABASE_URL, CODEX_DB_TEST_ACK=disposable-database-only,
REQUIRE_DB_TESTS=true:
npm run build
npm test -- src/agent-commerce/durable-worker.integration.test.ts
npm test

14 new database tests use synthetic providers/funding on REAL PostgreSQL. Without
URL they skip; required mode without URL fails. Tests create/drop only their own
random schema. Coverage includes parallel claims, all three adapters, accounting,
idempotent settlement, lease takeover, renewal, retries/exhaustion, revocation,
result visibility and rollback after final outbox-write failure. Real process kill,
heartbeat-failure timing, timeout timing and external effects remain unverified.
