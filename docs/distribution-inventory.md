# Offline distribution inventory: first bounded increment

Baseline inspected: 0ed57e3993055dcc3a5350530c5939acb18f3ce1. This patch reuses findProjectFile, the owner Orders registration/session boundary, and commerce UI styles. No new server, queue, schema family, dependencies, manifest edits, publication workflow, migration, runtime activation or external network request.

Adds owner-only GET /api/distribution and a local inventory panel to the existing Orders page, including its disabled/empty/error states. The report fingerprints existing server.json and glama.json; checks project-specific remote-only metadata constraints; reports name, version, sanitized configured endpoints, and explicit issues. This is NOT complete official JSON Schema validation, namespace/Glama ownership verification, remote endpoint health, registry read-back, listing presence or release approval. Publication and readiness always remain not_checked. Same-process file reads do not prove a deployed SHA or atomic multi-file release snapshot. Invalid local metadata does not block unrelated order reads or enable services.

New tests authored, not executed by the assistant: distribution-inventory.test.ts checks deterministic local metadata behavior, namespace drift, endpoint redaction, malformed input and actual owner-session HTTP access. Existing metadata must pass these limited checks; future manifest formats require reviewed updates rather than weakening a failure silently. Build and run this test plus existing Orders, owner-app and presentation suites at the resulting exact commit, then the full required PostgreSQL regression. No browser or deployment pass is asserted.

Next increments, separately reviewed:
1. Full official schema validation using a reviewed validator/publisher tool and pinned schema/version, without publishing.
2. Transactional idempotent prospect creation on existing owner lead records, with same-key/same-payload replay and conflicting-replay tests on real PostgreSQL. Correlation must distinguish an asserted inquiry reference from a verified link; a submitted order ID alone cannot establish buyer ownership, payment, attribution or conversion.
3. Explicit inquiry/prospect/commerce-job correlation against existing authorities. Preserve pilot access tokens and existing file-backed inquiry records; no silent migration or cross-database foreign-key claim.
4. Inspect existing task kind, verifier and policy contracts before adding a bounded qualification handler. No second queue; real execution needs permission checks, attempt/time/cost limits, model provenance and evidence-based outputs. No automatic stage promotion, outreach or financial writes.

This patch does not implement the later intake, correlation or worker steps. Existing manual intake remains non-idempotent until its dedicated increment lands. Repository-local changes and the owner's lockfile/stash are not altered by this remote commit.
