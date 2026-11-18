# Owner commerce order projection: first implementation increment

Scope: standalone commercial observability, not a War Lab module. No CI identifier allocated.
Baseline inspected: 16dd48ac26b897ecbecf77a413aea9f88e77974d on feat/agent-native-commerce-api.

## Implemented by this patch

- Read-only projection over existing agent_commerce jobs, reservations and results.
- Buyer/client/service/quote/job/receipt correlation without a second financial authority.
- Bounded parameterized reads, validated schema identifier, sanitized query errors.
- Monetary minor units retained as strings to avoid JavaScript precision loss.
- Explicit unknown attribution and unevaluated payment/reconciliation state.
- Unit tests for query contract, bounds, error redaction and field minimization.

## Not implemented or claimed

This class is not an HTTP endpoint and is not mounted in the dashboard. Its caller must enforce existing owner authentication; never expose this cross-buyer read model through buyer MCP dispatch. UUID ordering is deterministic, not chronological. No timestamps, pagination cursor, environment aggregation, registry telemetry, payment verification, financial recognition or margin computation are introduced. The runtime database must be isolated by deployment environment; this patch does not infer test/live status from jobs. No migrations, prices, dependencies, checkout links, live flags or deployments change.

## Verification

Tests authored, not executed by the assistant. No build, PostgreSQL, CI or deployment pass is asserted. Run in an isolated checkout of the resulting approved commit:

```sh
npm ci
npx vitest run src/control/owner-commerce-orders.test.ts
npm run build
```

Record resulting commit SHA, environment, commands, observed results and limitations. Mocked SQL tests do not establish PostgreSQL correctness. Before route integration, add real PostgreSQL fixtures covering queued/failed/succeeded jobs, absent receipts and two buyers, verify the existing joins are one-to-one, and test owner denial for anonymous and buyer sessions.

## Next integration

Inspect existing owner route/session contracts, add an owner-authenticated read route and linked Orders view with loading/empty/error states, then execute database and HTTP authorization tests. Correct the independently identified owner revenue daily-query currency mismatch in a separate reviewed patch. Preserve local package-lock.json and unrelated owner changes. No production enablement is authorized.
