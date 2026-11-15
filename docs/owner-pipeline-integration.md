# Phase 2 owner Pipeline integration

Status at preparation: unexecuted. The previously green ffd45d9 run does not validate this patch.

The local launcher constructs postgresPipelineWorkflow from the dedicated loopback owner task pool and the configured owner. The owner app registers Pipeline before its existing root handler and supplies the SAME current-session and Origin/session/CSRF guard closures used by task controls. No authentication bypass or public mounting is introduced. The form parser allows six parameters for csrf, commandId, leadId, from, to and reason. Unknown command fields, including actor, are rejected.

Pipeline retains analytics summaries and appends escaped lead approval controls. Analytics failures are shown separately from lead-store failures. The latest 100 lead rows are listed. Terminal stages have no controls. Missing migration 006 disables the lead-list controls. GET requests never apply migrations or write lead data.

Prerequisites: explicitly apply 005 and then 006 in the dedicated owner-local database after backup and review. The launcher does not apply these migrations. Existing lead records are required; lead intake UI is outside this patch. Actor identity is bound when the workflow is constructed, not accepted from the browser. The shared database remains single-owner; tenant isolation and independent dual approval are not implemented.

Approval writes the lead stage and a durable receipt atomically using PostgresLeadTransitions. This is not integration with the governance hash chain; receipts are ordinary database rows, not tamper-proof attestations. A won label never means funds were collected. No payment, outreach, agent network capability, spending or registry identity changes occur.

Tests: owner-pipeline-app.test.ts uses the real app authentication with synthetic credentials and a stub workflow. It covers actual Origin/session/CSRF rejection, six-field form parsing, JSON submission, actor injection, retained analytics and stage conflicts. These are HTTP tests, not proof of database transaction behavior. Run TypeScript and all no-database suites pinned to the resulting commit, and report the PostgreSQL skips separately. A disposable PostgreSQL run is still required for locking, rollback and migrations.
