# Planned agent-service foundation — replacement patch

This independently recreated patch is not the original lost archive. All three services are planned, UNCERTIFIED, unpriced, and unregistered. No CI identifiers are assigned.

- codex_pricing_snapshot: strict payload validation, no fetcher.
- codex_pricing_compare: pure comparison of stored snapshots, no fresh fetching.
- codex_document_extract: scalar-fields-v1 payload validator, no parser/intake.

No manifest, catalog, HTTP, dispatcher, checkout, or entitlement changes. No service activation or autonomous purchasing. Base44 remains authoritative for buyers, entitlements, balances, jobs, results, and settlement.

## Trust boundaries
Evidence validation checks lexical consistency only. It does not prove provenance, truth, field attribution, completeness, buyer ownership, or producer trust. URL validation is syntactic and is not SSRF protection. No URL is fetched here. Error strings are fixed. Input must be size-limited before JSON parsing by a future boundary; these validators bound fields, not inbound bytes.

The future authorized backend must load both snapshots under the authenticated buyer, assign stable plan identities, verify temporal/source compatibility, and supply afterCompleteTrusted from server-controlled producer metadata. Never expose that flag as a buyer-controlled tool argument. Only trusted, nonempty complete after-snapshots permit plan_removed. Partial/untrusted absence yields plan_not_observed; a missing amount yields price_unavailable. Currency/billing changes are terms_changed, not comparable price deltas.

Document limits are proposed: 20 pages, 100 fields. Strings, finite numbers, booleans, and null are supported. Unknown values use null with null evidence. Scalar lexical checks cannot establish that text belongs to the claimed page/field. No PDF parser, intake, authentication, storage adapter, or purchase handling is provided. assertPublicationAllowed is a local helper only, not a deployed enforcement boundary.

## Validation and release
Synthetic tests are not customer activity, demand evidence, certification, or release-gate evidence. Run the full npm test and npm run build on Node >=22 using project dependency policy. Preserve existing/untracked lockfiles; do not automatically stage them. Record patch/commit identity, environment, timestamp, command/case, expected and observed outcome, redacted output, and PASS/FAIL/INCONCLUSIVE. Archive creation is not execution evidence.

AX-01/AX-02/AX-04 evidence and release gates A-G remain blocking. Obtain exact-action approval before commits/pushes/PRs; production activation requires a separate HUMAN GATE. Do not merge/deploy automatically. Do not commit the archive or PATCH-MANIFEST.json as repository source.
