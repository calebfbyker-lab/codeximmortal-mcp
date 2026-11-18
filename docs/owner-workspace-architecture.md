# Owner workspace and live work queue

## Source of truth and routing
The PostgreSQL OwnerTaskQueue remains authoritative. This patch creates no tasks,
no schema, no financial action, and no registry identity. GET /api/work-queue is
owner-authenticated before reading; session validity is checked again after the
read. The response projects at most 50 records and omits result payloads, command
keys, worker identities, verifier identities and baseline data. Capture time is
read time, not task update time. The server coalesces concurrent reads and caches
snapshots for two seconds within the single-owner app instance. A database outage
is unavailable, not an empty queue. Store query timeouts remain authoritative;
the queue reader does not implement cancellation or an extra request deadline.

## Shared layout migration
renderWorkspace, workspaceNavigationHtml, workspaceDiagnostics and workQueuePanel
are reusable server-rendered components. All authenticated HTML goes through the
same outer renderer. Existing console and commerce renderers remain content
producers through adaptOwnerPage: their trusted main content is extracted, while
their outer document, sidebar, header, and footer are discarded. This is a bounded
migration adapter, not a completed source-level extraction of every legacy view.
Unexpected main structure returns a sanitized 500 instead of a partial page.
Overview is rendered directly, not extracted from the old status-card screen.
Login stays separate. No installer must be run after pulling this commit.

## Live state
The browser polls every five seconds after successful reads. Requests never
overlap. Errors back off to at most 60 seconds; hidden tabs pause and active fetches
are aborted. Page exit stops polling. Ready, stale, unavailable, disabled and
expired are explicit reducer states. Last-good rows remain visible and labeled
stale during an outage. A 401 clears prior rows and stops polling. The UI does not
renew sessions or automatically submit task mutations. New row values use DOM
textContent, never innerHTML. The CSP allows same-origin connect-src only.

## Scope limitations
The queue is a returned record window, not a global count. Verified and cancelled
records stay on Tasks. Created timestamps are not state-entry times. Queue/store
access does not prove worker liveness. Commercial sources are inspected on their
own pages and are not inferred from task health. Existing approval/governance
atomicity and financial-accounting work remain separate; this patch preserves
existing mutation guards rather than claiming those workflows are certified.

## Validation
Run npm run build, then npx vitest run src/control src/buyer-surface-consistency.test.ts.
For optional browser dependencies: npm install --no-save --package-lock=false playwright
then npx playwright install chromium. Run node scripts/check-owner-workspace.mjs.
The browser harness starts an isolated local app with synthetic credentials and
one synthetic task, blocks external origins, and intercepts its HTTPS-origin
requests into the local fixture. It never uses a live database. It checks all nine
pages at 1440/768/390 pixels, one main/navigation/active item, logout, collapsed
diagnostics, contained overflow, queue updates, stale retention and session expiry.
Screenshots and completed check records go to output/workspace-browser; the process
exit status is authoritative. It does not establish production TLS, real buyer
activity, working payment, or database-backed readiness. No build, Vitest or browser
pass is claimed merely because these tests are present.
