# Growth runtime foundation

Status: PROVISIONAL / UNCERTIFIED. No CI identifier assigned. Dispatch stays paused by default; this is a bounded deterministic proposal runtime, not a self-training swarm or an autonomous sales system.

## Architecture
Recorded observations -> idempotent enqueue -> paused-by-default PostgreSQL queue -> leased worker -> server-side recomputation -> stored proposal -> separate owner review. Acquisition preserves evidence without inferring purchase intent; conversion proposes a cohort experiment after 30 observations; pricing records an owner-gated review; code evolution proposes investigation after five failures. No agent executes outreach, prices, payments, code patches or deployments.

## Repository integration
Uses existing pg, Express and Vitest dependencies and reads real agent_commerce.jobs columns. Apply migrations/007_growth_runtime.sql manually only to an approved disposable database for verification. No automatic migration or activation occurs. GrowthRuntime accepts a Pool; one trusted operator per schema.

createOwnerControlApp accepts an optional growth: GrowthRuntime parameter. When supplied, registerGrowthRoutes(app, current, guarded, growth) mounts GET/POST /api/growth/runs behind the existing owner session, Origin and CSRF guards and the existing 2kb body limits. Reads require a live session; writes require Origin plus CSRF. When no runtime is supplied the routes stay unmounted. No dashboard view, worker launcher, scheduler, external collector, LLM provider, budget engine, training pipeline or deployment is included, and no agent can self-grant authority through these routes.

## Metrics and feedback
readFulfilledCharges returns decimal strings grouped by currency for a job-created-at cohort. Missing quote timestamps, settlement timing, refunds and costs remain unavailable rather than fabricated zeroes. It does not report profit, accounting revenue, MRR or cross-stage conversion. Follow-up accounting must reconcile settlement and refunds, currency-specific costs and customer-linked cohorts before optimizing profit.

## Verification and progression
- src/growth/agents.test.ts: six proposal-contract unit tests.
- src/growth/runtime.integration.test.ts: eleven real-PostgreSQL invariant tests (paused default, missing-policy fail-closed, concurrent idempotency dedupe and conflicts, concurrent claim exclusion, lease renewal and fencing, pause/resume, retry exhaustion, once-only completion, event-write rollback).
- src/growth/growth-http.integration.test.ts: five authenticated HTTP tests through the real owner app (unauthenticated, cross-origin and forged-CSRF rejection with zero persistence; queue read; idempotent enqueue; invalid-role and conflict rejection; unmounted when unconfigured).
- Recorded local evidence (user-reported, not remote CI): 2026-11-19 vitest 2.1.9, 17/17 targeted growth suites and 531/531 full regression, zero failures, no worker exits. npm run build output not yet recorded.

Next increments: dashboard view wiring; event collectors and independent evidence evaluation; bounded orchestrator and real cost reservations; controlled experiments; finally curated offline learning. AX telemetry, certification and exercises remain outstanding.
