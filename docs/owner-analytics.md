# Owner analytics: revenue and pipeline (Phase 1)

Status: implemented and covered by a no-database vitest suite; NOT executed.
No build, test run, migration or deployment has been performed for this
increment. Phase 2 (governed stage transitions) and Phase 3 (gated agentic
lead generation) are deliberately not built.

## What this increment implements

- Migration 005: owner_revenue_events (idempotent per source event id) and
  owner_leads (stage-checked) tables in the owner-local schema.
- owner-analytics.ts: PostgresAnalyticsStore with revenueSummary (gross,
  refunds, fees, net, by-day series; dominant currency only — multi-currency
  aggregation is a known limitation), pipeline (stage counts, won value,
  conversion), idempotent upsertRevenueEvents and addLead. All queries are
  parameterized; bigint aggregates are parsed from pg's string form.
- owner-stripe-sync.ts: syncStripeRevenue pulls /v1/balance_transactions
  (paginated, max 20 pages) through a pinned-host, TLS-1.2, 15s-timeout,
  5MB-cap read of api.stripe.com, maps types to charge/refund/fee/other, and
  caches into the owner database. The CLI entry requires
  CODEX_STRIPE_READ_KEY (a restricted read-only key, set locally, never in
  chat), CODEX_STRIPE_READ_ACK=local-read-only-key and the owner database
  variables; it fails closed without the acknowledgment.
- Owner console: Revenue view (KPI cards, CSP-safe CSS bar chart of net by
  day, recent-days table) and Pipeline view (stage funnel, won value,
  conversion), both with honest fail-closed states. GET /api/analytics serves
  the same data as JSON behind the session.

## Honest limits — read before trusting the numbers

- Net revenue reflects Stripe fees and refunds only. Business costs are NOT
  included because no cost meter exists yet (AX-05 is spec-complete, not
  deployed). The Revenue view says this explicitly: it is not profit.
- Data is a local cache of Stripe balance transactions at sync time; it is
  not live and can go stale. Currency handling assumes one dominant currency.
- The sync uses a restricted read-only key that cannot move money; the key is
  read from the local environment and never logged or sent anywhere except
  api.stripe.com over verified TLS.
- Agentic lead generation is NOT in this build: the fixed task policy floor
  (network=false, spendCents=0) forbids outbound automation, and enabling it
  requires policy v2, a reviewed migration and code change, and an explicit
  [HUMAN GATE]. Phase 2 (governed lead stage transitions with audit) and
  Phase 3 (gated agentic execution) remain proposals.
- Registry alignment: this prototypes CI-049 DEFENSE-BUDGET-TWIN territory
  (Planned); nothing here registers or modifies CI state without AX-03
  REGISTRY-SYNC and [HUMAN GATE].
- Unexecuted: after npm.cmd run build, run npm.cmd exec -- vitest run
  src/control/owner-analytics.test.ts as part of the guarded local procedure,
  with zero skips. Local success is not remote CI success; GitHub Actions
  remains unverified.
