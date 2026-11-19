# Growth runtime foundation

Status: PROVISIONAL / UNCERTIFIED. No CI identifier assigned. Build, unit tests, database integration and deployment are unverified. This is a bounded deterministic proposal runtime, not a self-training swarm or an autonomous sales system.

## Architecture
Recorded observations -> idempotent enqueue -> paused-by-default PostgreSQL queue -> leased worker -> server-side recomputation -> stored proposal -> separate owner review. Acquisition preserves evidence without inferring purchase intent; conversion proposes a cohort experiment after 30 observations; pricing records an owner-gated review; code evolution proposes investigation after five failures. No agent executes outreach, prices, payments, code patches or deployments.

## Repository integration
Uses existing pg, Express and Vitest dependencies and reads real agent_commerce.jobs columns. Apply migrations/007_growth_runtime.sql manually only to an approved disposable database for verification. No automatic migration or activation occurs. GrowthRuntime accepts a Pool; one trusted operator per schema. Database credentials and worker token access are trusted capabilities, not public APIs.

The owner-route adapter is supplied but NOT mounted. In src/control/owner-app.ts, a later reviewed change can call registerGrowthRoutes(app,current,guarded,runtime) after owner guards are defined. Preserve the existing session, Origin, CSRF and 2kb body limits. No dashboard UI, worker launcher, scheduler, external collector, LLM provider, budget engine, training pipeline or deployment is included.

## Metrics and feedback
readFulfilledCharges returns decimal strings grouped by currency for a job-created-at cohort. Missing quote timestamps, settlement timing, refunds and costs remain unavailable rather than fabricated zeroes. It does not report profit, accounting revenue, MRR or cross-stage conversion. Follow-up accounting must reconcile settlement and refunds, currency-specific costs and customer-linked cohorts before optimizing profit.

## Verification and progression
Run npm run build and npx vitest run src/growth/agents.test.ts. Then add disposable PostgreSQL tests for migration, command conflicts, concurrent claims, lease expiry, pause, retries and atomic completion; add authenticated HTTP tests before mounting routes. No command here has been executed. Next increments: authenticated owner mounting and dashboard; event collectors and independent evidence evaluation; bounded orchestrator and real cost reservations; controlled experiments; finally curated offline learning. AX telemetry, certification and exercises remain outstanding.
