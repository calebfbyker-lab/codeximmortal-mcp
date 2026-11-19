# Growth runtime foundation

Status: PROVISIONAL / UNCERTIFIED. No CI identifier assigned. Dispatch stays paused by default; this is a bounded deterministic proposal runtime with a local worker, not a self-training swarm or an autonomous sales system.

## Architecture
Recorded observations -> idempotent enqueue -> paused-by-default PostgreSQL queue -> local worker claim -> server-side recomputation -> stored proposal -> separate owner review. Acquisition preserves evidence without inferring purchase intent; conversion proposes a cohort experiment after 30 observations; pricing records an owner-gated review; code evolution proposes investigation after five failures. No agent executes outreach, prices, payments, code patches or deployments.

## Local worker
src/growth/worker.ts provides GrowthWorker: a poll loop that claims runs, heartbeats the lease, and completes deterministic proposals server-side. src/growth/worker-main.ts is the local entry point. It runs entirely on the owner's machine against their PostgreSQL; no GitHub Actions or other hosted CI is involved.

```powershell
npm run build
$env:DATABASE_URL='postgres://...'
$env:GROWTH_WORKER='on'
npm run growth:worker
```

Optional: GROWTH_WORKER_NAME (default local-worker), GROWTH_WORKER_POLL_MS (100..60000, default 2000). Stop with Ctrl+C; SIGINT/SIGTERM stop the loop cleanly and close the pool.

The daemon requires GROWTH_WORKER=on to start at all, and remains inert until the owner sets growth_runtime.policy.paused=false in the database. It executes no shell commands, no git operations, and no network calls in this increment; it only turns queued commands into verified proposals and events. Tier-1 local execution (npm build/test evidence, draft branches) is the next increment behind a command allowlist.

## Repository integration
Uses existing pg, Express and Vitest dependencies and reads real agent_commerce.jobs columns. Apply migrations/007_growth_runtime.sql manually only to an approved disposable database for verification. No automatic migration or activation occurs. GrowthRuntime accepts a Pool; one trusted operator per schema.

createOwnerControlApp accepts an optional growth: GrowthRuntime parameter. When supplied, registerGrowthRoutes(app, current, guarded, growth) mounts GET/POST /api/growth/runs behind the existing owner session, Origin and CSRF guards and the existing 2kb body limits. Reads require a live session; writes require Origin plus CSRF. When no runtime is supplied the routes stay unmounted. No dashboard view, scheduler, external collector, LLM provider, budget engine, training pipeline or deployment is included, and no agent can self-grant authority through these routes.

## Metrics and feedback
readFulfilledCharges returns decimal strings grouped by currency for a job-created-at cohort. Missing quote timestamps, settlement timing, refunds and costs remain unavailable rather than fabricated zeroes. It does not report profit, accounting revenue, MRR or cross-stage conversion. Follow-up accounting must reconcile settlement and refunds, currency-specific costs and customer-linked cohorts before optimizing profit.

## Verification and progression
- src/growth/agents.test.ts: six proposal-contract unit tests.
- src/growth/runtime.integration.test.ts: eleven real-PostgreSQL invariant tests.
- src/growth/growth-http.integration.test.ts: five authenticated HTTP tests through the real owner app.
- src/growth/worker.integration.test.ts: five local-worker tests (idle while paused, claim-and-verify on resume, expired-lease reclamation, abort handling, constructor validation).
- Recorded local evidence (user-reported, not remote CI): 2026-11-19 vitest 2.1.9, 17/17 targeted growth suites, 531/531 full regression, and 5/5 HTTP suite after the schema-creation fix. npm run build output not yet recorded.

Next increments: Tier-1 local execution allowlist (npm build/test evidence, draft branches); event collectors feeding roles from real repo telemetry; dashboard view wiring; outcome ledger for predictive ranking; controlled experiments; curated offline learning. AX telemetry, certification and exercises remain outstanding.
