# Owner Orders dashboard increment

Scope: standalone commercial repository work; no War Lab CI assignment or doctrine change.
Baseline: owner projection at 24abcfb8bc532fb7120c7343fdbc14957b6275a7. Owner-supplied local evidence: build exit 0; 33 selected tests passed on Windows, Node 25.9.0, npm 11.21.2, Vitest 2.1.9 and disposable PostgreSQL 16. This is not evidence for the new patch or GitHub CI.

## Integration

- Existing owner app registers GET /api/orders and GET /orders using the same current-session function as existing routes. Buyer bearer tokens are not owner sessions.
- Dashboard HTML adds an Orders navigation link; the separate Orders page reuses owner CSS, provides a return link, escaped table cells, manual refresh, and disabled/empty/error states. Server rendering waits for the read; no asynchronous loading spinner is claimed.
- The API always reads at most 50 jobs and does not accept arbitrary filters, schema or buyer IDs. UUID/job-ID order is not chronological. No pagination or detail pages yet.
- Amounts remain strings in minor units with explicit currency. No cross-currency total, paid status, profit or verified referral is inferred.
- No payment actions, raw job inputs, result bodies, buyer credentials, registry publication or schema migration are introduced.

## Default-off local launcher

No environment values are changed by this patch. Keep CODEX_OWNER_ORDERS_ENABLED unset or false until this resulting commit is validated. The existing local HTTPS launcher and certificate configuration remain required.

After validation and explicit local activation, configuration requires all three values supplied privately on the operator machine:

- CODEX_OWNER_ORDERS_ENABLED=true
- CODEX_OWNER_ORDERS_ACK=local-read-only-commerce
- CODEX_OWNER_ORDERS_DATABASE_URL pointing to the intended local standalone commerce database, not the owner-task database by assumption.

Only loopback postgres/postgresql URLs without query parameters are accepted. The pool sets default_transaction_read_only=on and bounded connection/statement timeouts. Use a separately provisioned least-privilege SELECT role; this patch does not create roles/grants and a session default is not a substitute for privileges. Environment separation is by dedicated configured database, not inferred from rows. No migrations run at startup. The public MCP app is unchanged.

## Verification required for this patch

Build and test the resulting exact commit in an isolated worktree. Reuse the disposable PostgreSQL harness, expanding its selected files to:

```
src/control/owner-commerce-orders.test.ts
src/control/owner-commerce-orders.integration.test.ts
src/control/owner-orders-http.integration.test.ts
src/control/owner-app.integration.test.ts
src/agent-commerce/postgres-commerce.integration.test.ts
```

Run npm run build and retain SHA/runtime/dependency/test evidence. New tests are authored, not executed by the assistant. Projection SQL is tested with actual migration-created tables and synthetic queued/succeeded/failed jobs across three buyers, optional results, USD/EUR separation, row bounds and read-only transaction compatibility. HTTP tests use mocked read data and the actual owner-login/session app. No browser visual/accessibility verification or integrated HTTPS-to-PostgreSQL result is claimed. Existing revenue currency-query defect and unrelated full-suite failures remain out of scope. Existing baseline workflow stays pinned to its old source SHA; it does not validate this patch. Full existing CI may also run independently.
