# Snapshot integrity: P0 items 1-3

Status: implemented and covered by a dedicated no-database vitest suite; NOT
executed. No build, test run, migration or deployment has been performed for
this change. The branch also carries the unexecuted Stage 8 and safe-fetch
suites.

## Item 1 — Original-source evidence

- locateOfferSpans (snapshot-provider.ts) scans the raw JSON body and records
  the exact character span of every offer: top-level array, or the value of
  the first "offers" key of a top-level object. Duplicate "offers" keys are
  rejected (JSON.parse keeps the last, which would misalign spans). Spans are
  capped at 16384 characters and 100 offers; structural surprises fail closed
  with invalid_source_content.
- extractPlans pairs each parsed offer with its original span; the excerpt is
  always the raw body slice, never a regenerated string.
- Evidence (contracts.ts) now carries sourceStart/sourceEnd alongside text and
  token; evidence.ts validates the span fields (0 <= start < end, span <= 16384)
  and was rewritten regex-free with identical token semantics.
- Consequence: previously persisted evidence (text/token only) no longer
  validates; no producer of that shape exists in the repo. Document
  extraction (P0 item 6) must supply spans when implemented.

## Item 2 — Stable identity and verified retries

- Plan identity is keyed on the plan name (sha256, 12 hex chars), not on
  amount: a price change keeps the same id so comparisons report price_changed
  instead of degrading into remove+add. Reordering the offers array preserves
  ids because ordinals within a shared-name group are assigned by sorted
  content, never by array position.
- postgres-snapshot-sink.ts reads back the persisted payload and provenance
  inside the same transaction after insert-on-conflict and compares them with
  the retry via canonicalJson (recursive key-sorted form, so jsonb key
  reordering cannot cause false disagreement). Any mismatch rolls back and
  surfaces as snapshot_sink_failed: a retry can no longer report success while
  the stored row differs from the payload the caller received.

## Item 3 — Consistent paired reads and coverage trust

- worker.ts pricing_compare prefers an optional snapshotPair provider (a
  single consistent read of both snapshots) and falls back to sequential reads
  verified by re-read: immutable rows must return identical values on both
  reads or the worker fails closed with inconsistent_snapshot_pair (502).
- completeTrusted remains strictly boolean-gated: compareSnapshots emits
  plan_added/plan_removed only when the corresponding coverage is complete,
  non-empty, and explicitly trusted; otherwise plan_first_observed /
  plan_not_observed. Unverified complete coverage never licenses an inference.

## Honest limits

- The span scanner is character-based and rejects scientific-notation amounts
  it cannot verify as standalone numbers; such sources fail closed.
- The fallback re-read detects store drift but is not a substitute for a
  transactional pair read; the Postgres source store should implement
  snapshotPair (P0 item 5 territory) to get single-transaction consistency.
- Existing suites that assert the old evidence shape, old sink SQL sequence, or
  old plan id format may need updating; nothing has been executed yet.
- P0 items 4-8 status: item 4 (fetch hardening) implemented unexecuted; items
  5-8 (ownership bridge, document extraction, commerce integrity, release
  evidence) remain open.
- Unexecuted: after npm.cmd run build, run npm.cmd exec -- vitest run
  src/agent-services/snapshot-integrity.test.ts as part of the guarded local
  procedure, with zero skips. Local success is not remote CI success; GitHub
  Actions remains unverified.
