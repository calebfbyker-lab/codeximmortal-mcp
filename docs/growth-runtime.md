# Growth runtime foundation

Status: PROVISIONAL / UNCERTIFIED. No CI identifier assigned. Dispatch stays paused by default; this is a bounded deterministic proposal runtime with a local worker and a local planning loop, not a self-training swarm or an autonomous sales system.

## Architecture
Recorded observations -> idempotent enqueue -> paused-by-default PostgreSQL queue -> local worker claim -> server-side recomputation -> stored proposal -> separate owner review. Acquisition preserves evidence without inferring purchase intent; conversion proposes a cohort experiment after 30 observations; pricing records an owner-gated review; code evolution proposes investigation after five failures. No agent executes outreach, prices, payments, code patches or deployments.

## Local worker
src/growth/worker.ts provides GrowthWorker: a poll loop that claims runs, heartbeats the lease, and completes deterministic proposals server-side, honoring failed renewals and refused completions. src/growth/worker-main.ts is the local entry point. It runs entirely on the owner's machine against their PostgreSQL; no GitHub Actions or other hosted CI is involved.

```powershell
npm run build
$env:DATABASE_URL='postgres://...'
$env:GROWTH_WORKER='on'
npm run growth:worker
```

Optional: GROWTH_WORKER_NAME (default local-worker), GROWTH_WORKER_POLL_MS (100..60000, default 2000). The daemon requires GROWTH_WORKER=on to start at all, and remains inert until the owner sets growth_runtime.policy.paused=false in the database. It executes no shell commands, no git operations, and no network calls.

## Local AI planning and evolution loop
src/growth/local-ai.ts adapts a fixed loopback Ollama endpoint (http://127.0.0.1:11434/api/chat) with structured-output enforcement, bounded context (24KB) and response (64KB), no cloud fallback, and model-name rejection for cloud tags. Model-name checks cannot detect a custom alias backed by a remote service; the local Ollama server must also be configured local-only.

src/growth/repo-context.ts collects read-only, allowlisted repository facts: file names and sizes under src/growth, plus the contents of the growth docs. Missing or non-directory roots throw invalid_repo_root before any context is collected. Nothing else is read; secrets stay out of model input. Output is bounded to 12KB with an explicit truncation marker.

src/growth/evolve.ts runs one recursion step: the objective, the last five stored candidate objectives (history, not authority), and the repo context go to the local model; the validated plan is stored durably in growth_runtime.candidates (migrations/008_growth_candidates.sql) with a context digest. Identical model+objective+context runs dedupe instead of duplicating. Each subsequent run sees prior candidates, which is the recursion; candidates remain unreviewed until the owner accepts or rejects them. Nothing in this loop executes, approves, integrates or releases anything.

Run it with CLI flags (shell-agnostic) or environment variables. GROWTH_LOCAL_AI=on is the required gate in both forms.

```cmd
npm run build
set GROWTH_LOCAL_AI=on
npm run growth:evolve -- --model llama3:latest --objective "Improve the owner dashboard review flow with evidence per proposal" --db postgres://user:pass@localhost:5432/disposable_db
```

```powershell
npm run build
$env:GROWTH_LOCAL_AI='on'
$env:GROWTH_LOCAL_MODEL='llama3:latest'
$env:GROWTH_EVOLVE_OBJECTIVE='Improve the owner dashboard review flow with evidence per proposal'
$env:DATABASE_URL='postgres://...'
npm run growth:evolve
```

CLI flags override env vars: --model, --objective, --db. In cmd.exe, quote the objective in double quotes. A database URL passed via --db appears in the process list and shell history; prefer env vars for shared machines.

## Local migration runner
src/growth/migrate-main.ts applies migrations/007_growth_runtime.sql and 008_growth_candidates.sql through the pg driver, so no psql install is needed. It requires the disposable-database acknowledgment (CODEX_MIGRATE_ACK=disposable-database-only, matching the integration-test convention) and a --db flag or DATABASE_URL. Each migration is skipped when its target table already exists, so the command is safe to re-run. It only creates tables; it drops nothing.

```cmd
npm run build
set CODEX_MIGRATE_ACK=disposable-database-only
npm run growth:migrate -- --db postgres://user:pass@localhost:5432/disposable_db
```

Predictive ranking of candidates is deliberately not included: there are no accepted/rejected outcomes to learn from yet. Add outcome labeling first, then an evaluated ranking model behind the owner gate.

## Repository integration
Uses existing pg, Express and Vitest dependencies and reads real agent_commerce.jobs columns. GrowthRuntime accepts a Pool; one trusted operator per schema.

createOwnerControlApp accepts an optional growth: GrowthRuntime parameter. When supplied, registerGrowthRoutes(app, current, guarded, growth) mounts GET/POST /api/growth/runs behind the existing owner session, Origin and CSRF guards and the existing 2kb body limits. Reads require a live session; writes require Origin plus CSRF. When no runtime is supplied the routes stay unmounted. No dashboard view for candidates, external collector, LLM training pipeline or deployment is included, and no agent can self-grant authority through these routes.

## Metrics and feedback
readFulfilledCharges returns decimal strings grouped by currency for a job-created-at cohort. Missing quote timestamps, settlement timing, refunds and costs remain unavailable rather than fabricated zeroes. It does not report profit, accounting revenue, MRR or cross-stage conversion. Follow-up accounting must reconcile settlement and refunds, currency-specific costs and customer-linked cohorts before optimizing profit.

## Verification and progression
- src/growth/agents.test.ts: six proposal-contract unit tests.
- src/growth/runtime.integration.test.ts: eleven real-PostgreSQL invariant tests.
- src/growth/growth-http.integration.test.ts: five authenticated HTTP tests through the real owner app.
- src/growth/worker.integration.test.ts plus worker.test.ts: nine worker tests.
- src/growth/local-ai.test.ts: five adapter boundary tests.
- src/growth/repo-context.test.ts: three allowlist and budget tests.
- src/growth/evolve.test.ts: four recursion, dedupe and rejection tests.
- Recorded local evidence (user-reported, not remote CI): 2026-11-19 vitest 2.1.9, build clean and 36/36 growth tests at 2e3a69a; earlier 17/17 and 531/531 on prior commits. Commits 1d34a05 through 7fc4c14 add the evolution loop and are locally verified only for build (2026-11-20); growth:migrate is new and unverified.

Next increments: owner dashboard view for candidates and outcome labeling; recurring lease renewal for long inference; model timeout and think controls; scoped repo tools beyond read-only context; isolated patch execution; commercial adapters; evaluated ranking only after outcomes exist. AX telemetry, certification and exercises remain outstanding.
