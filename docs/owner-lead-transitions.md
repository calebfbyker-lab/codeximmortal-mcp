# Owner lead transitions: Phase 2 (governed stage changes)

Status: implemented with regression tests; NOT executed. No build or test run
has been performed for this increment. The no-database suite and the 67
skipped PostgreSQL suites remain as previously verified at ffd45d9.

## What this increment implements

- Migration 006: owner_lead_transition_events in the owner-local schema.
  Receipts reference owner_leads, record the approving actor, expected and
  resulting stage, owner-supplied reason, pinned policy version 1, and
  decision 'approved'. Applied explicitly after 005.
- owner-lead-transitions.ts: PostgresLeadTransitions.approve executes inside
  one transaction with statement and lock timeouts. Stage changes follow a
  fixed forward-or-lost policy (new -> qualified -> engaged -> won, or lost
  from any live stage; won and lost are terminal). The lead row is locked and
  checked against the expected current stage before update, so concurrent or
  stale attempts fail with lead_stage_conflict instead of silently winning.
  The stage update and its approval receipt commit together or roll back
  together.
- Idempotent retries: each command carries a server-generated UUID. An
  identical retry returns the original approval with no second update. A
  retry that reuses a command ID with different content, lead, actor, stages
  or reason is rejected as lead_command_conflict. Advisory transaction
  locking serializes duplicate command IDs, including retries that target a
  different lead.
- Errors are fail-closed and redacted. Driver and SQL details never surface;
  callers see typed codes only. Inputs are validated before any database
  access, and the actor always comes from the verified owner session, never
  the request body.

## Honest limits

- This is explicit owner approval, not independent dual approval: the same
  owner proposes and confirms transitions. Policy version is pinned to 1 by
  CHECK constraint; a stage-model change requires a reviewed migration and
  code change.
- Stage 'won' is a pipeline label, not verified revenue. It implies no
  payment, collected funds or external action.
- This store does not add lead creation, editing or deletion. It does not
  emit governance audit-chain events or wire dashboard routes; those are
  separate increments under separate approval.
- No agentic capability is added: the fixed task policy floor (network=false,
  spendCents=0) is untouched, and this module cannot send messages, spend
  money or act outside the owner-local database.
- Tests use an in-memory fake client; they do not exercise a real PostgreSQL
  transaction. The migration and SQL path are unexecuted. Run the guarded
  local procedure plus a disposable-PostgreSQL check before relying on this.
