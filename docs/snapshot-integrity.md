# Snapshot integrity: P0 items 1-3

Status: implemented, correctively patched, and covered by no-database
vitest suites; NOT executed. No build, test run, migration or deployment has
been performed for any of this. The branch also carries the unexecuted Stage 8
and safe-fetch suites.

## Item 1 — Original-source evidence

- locateOfferSpans (snapshot-provider.ts) scans the raw JSON body and records
  the exact character span of every offer: top-level array, or the value of
  the first "offers" key of a top-level object. Duplicate "offers" keys are
  rejected (JSON.parse keeps the last, which would misalign spans). Spans are
  capped at 16384 characters and 100 offers; structural surprises fail closed
  with invalid_source_content.
- extractPlans pairs each parsed offer with its original span; the excerpt is
  always the raw body slice, never a regenerated string.
- Evidence (contracts.ts) carries sourceStart/sourceEnd alongside text and
  token; evidence.ts validates the span fields (0 <= start < end, span <= 16384)
  and is implemented without regexes.
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
  surfaces as snapshot_sink_failed.

## Item 3 — Consistent paired reads and coverage trust

- worker.ts pricing_compare prefers an optional snapshotPair provider (a
  single consistent read of both snapshots) and falls back to sequential reads
  verified by re-read: immutable rows must return identical values on both
  reads or the worker fails closed with inconsistent_snapshot_pair (502).
- A single-statement consistent pair read already exists in
  PostgresSnapshotRepository.findOwnedPair (snapshot-repository.ts); wiring it
  into the production Providers construction is a pending follow-up.
- completeTrusted remains strictly boolean-gated: compareSnapshots emits
  plan_added/plan_removed only when the corresponding coverage is complete,
  non-empty, and explicitly trusted; otherwise plan_first_observed /
  plan_not_observed.

## Corrective patch (code review findings, still unexecuted)

1. evidence.ts standaloneNumbers: the numeric run now consumes a leading sign
   before scanning digits and skips zero-length runs defensively — a signed
   number like "Price: -10" could previously stall the scan at the sign with no
   progress.
2. pricing-snapshot.test.ts, document-extract.test.ts and
   pricing-compare.test.ts fixtures migrated to span-carrying evidence; the
   old shape fails invalid_fields by design.
3. snapshot-integrity.test.ts: the sink fixture now models the real pg result
   shape (rows[0].payload) and uses coherent span bounds; added a non-stall
   regression test for signed numbers.
4. safe-fetch.ts: the connect call is raced against abort so a non-settling
   connection can never stall a fetch (the durable worker's outer 30s timeout
   is a backstop, not the only defense); response streams are now disposed on
   redirect-limit, invalid-redirect, upstream-unavailable and
   invalid-source-status paths, not only on redirect and read failure.
5. postgres-snapshot-sink.ts: a complete-coverage claim is cross-checked
   against its own plan data (every plan must carry a parsed amount) before
   the verified flag is persisted.

## Honest limits

- The complete-coverage cross-check makes the stored flag internally
  consistent with the payload; it does NOT prove the capture saw every plan
  the source offers. That stronger guarantee needs independent verification
  (a second capture or buyer attestation) and remains an open production
  prerequisite.
- The span scanner rejects scientific-notation amounts it cannot verify as
  standalone numbers; such sources fail closed.
- The worker fallback re-read detects store drift but is not a transactional
  pair read; production wiring should use
  PostgresSnapshotRepository.findOwnedPair.
- All of this is unexecuted: after npm.cmd run build, run npm.cmd exec --
  vitest run src/agent-services/snapshot-integrity.test.ts plus the full
  suite as part of the guarded local procedure, with zero skips. Local
  success is not remote CI success; GitHub Actions remains unverified.
