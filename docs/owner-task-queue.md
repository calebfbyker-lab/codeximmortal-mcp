# Owner task queue: backend, dashboard wiring and governance

Queue backend baseline: ea8bf2311c4ccf71af92b9aa3d09ac0cfda22e1e. This increment wires
that committed queue into the authenticated owner dashboard and adds a governance and
state-persistence layer (migration 004). Commerce accounting tables, publication guards,
prices and deployment are unchanged.

## What this increment implements

- A Tasks view in the isolated owner console, resolving identity from the existing verified session. No new identity surface, no public registration, no mounting in public http.ts.
- POST /tasks/propose, /tasks/approve, /tasks/cancel, /tasks/pause, /tasks/resume and GET /api/tasks on the owner app only. Every mutation requires the exact configured HTTPS Origin, a valid session cookie and the session CSRF token. Forms redirect back to the Tasks view; JSON callers receive status codes.
- Proposals carry a server-generated idempotency command key rendered into the form; identical retries do not duplicate a task.
- Pause/resume persists in PostgreSQL. Pausing blocks new claims; accepted work may still submit and be verified.
- Missing queue configuration fails closed: the Tasks view shows a not-configured state, mutations are rejected, and no fabricated activity is displayed. An unreachable database shows a distinct failure state.
- Governance layer: versioned, sha256-hashed policy documents under a code-enforced floor (stored documents may only tighten the fixed limits); explicit approval records; an append-only hash-chained governance event ledger; worker/verifier heartbeats.
- Dashboard proposals fail closed when the active dispatch policy is missing or fails hash verification.
- CLI init applies migrations 003 and 004 transactionally once and seeds dispatch policy v1 from the code floor. init-governance applies 004 alone for databases that already have 003. HTTP startup never applies migrations.

## What is deliberately not implemented

- The dashboard never executes tasks in the web process. Workers and verifiers remain separate local CLI processes (node dist/control/owner-task-queue.js worker / verifier / run-once) and now record best-effort heartbeats.
- Actor labels are not authentication. Producer/verifier/admin PostgreSQL role separation is still missing and remains a production prerequisite.
- Sessions remain memory-only, single-session, 15-minute, and expire on restart. This is still a local prototype, not production auth.
- The dispatch policy kind owner_task_dispatch is pinned to version 1, matching the tasks table CHECK (policy_version=1). Publishing later versions requires a reviewed migration plus code change.
- The registry-report worker remains deterministic and is not LLM-powered AI. A verified result is structural registry-report equality at a baseline, not product readiness.

## Local operation after build and tests

Provision a dedicated local PostgreSQL database named codex_owner_control. Configure CODEX_OWNER_TASK_DATABASE_URL privately on your machine, never in chat/source/logs, and CODEX_OWNER_TASK_DB_ACK=local-owner-tasks-only. Loopback hosts only; the URL is rejected otherwise. This is not permission to reuse a financial database.

- node dist/control/owner-task-queue.js init — applies migrations 003 and 004 transactionally once and seeds dispatch policy v1; dispatch starts paused.
- node dist/control/owner-task-queue.js init-governance — applies migration 004 only, for a database that already has 003; also seeds the policy.
- Unchanged commands: propose "objective label"; approve TASK_UUID; cancel TASK_UUID; pause; resume; list; run-once; worker; verifier.

For task controls on the local HTTPS dashboard, set the same task-database variables in the shell before running scripts/Start-OwnerDashboard.ps1. The launcher initializes the queue before serving, and the startup self-check now also verifies GET /api/tasks, failing closed if the configured database is unreachable. Without the variables, the dashboard runs and shows the not-configured state. Build from the intended exact HEAD before running; the CLI records the local Git HEAD as provenance, not an attested build.

Pause semantics, lease fencing, attempt budgets, cancellation fencing and verification rules are unchanged from the backend increment and covered by its tests.

## Evidence

Prepared, not executed by an assistant. New suites:

- src/control/owner-tasks-http.test.ts — no database: policy-floor checks, configuration rejection, console rendering including escaping, and stub-store HTTP boundary tests for origin/session/CSRF enforcement, not-configured fail-closed behavior, the policy gate, and form/JSON contracts.
- src/control/owner-tasks-http.integration.test.ts — real disposable PostgreSQL: live API state, proposal, approval with a persisted approval record, pause/resume persistence, verifier outcome display, cancellation fencing, owner isolation, governance chain.
- src/control/owner-governance.integration.test.ts — real disposable PostgreSQL: seeding idempotency, floor rejection, version pinning, hash-mismatch fail-closed, versioning/superseding for other kinds, concurrent audit chain integrity with tamper detection, approval idempotency, heartbeats.

No local build, test, migration or worker run was executed for this commit series. Run the guarded disposable-PostgreSQL procedure and the full suite before relying on any of it. Local success is not remote CI success; GitHub Actions remains unverified.
