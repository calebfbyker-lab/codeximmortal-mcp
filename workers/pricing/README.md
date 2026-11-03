# Pricing worker 0.2.1

PROPOSED / UNCERTIFIED. No CI identifier. Revised baseline reconstructed from the earlier package; not byte-identical. No deployed endpoint, customer authentication, credit ledger, durable queue, source fetcher or checkout integration. Root MCP application and catalog remain unchanged.

Run npm install, npm run build, npm test, npm run evaluate from workers/pricing. Twenty-three authored tests use mocked providers/transports. Four evaluation fixtures inject known answers and synthetic usage; they do NOT measure actual model quality, costs, demand or production readiness. No build or tests are claimed executed before CI results exist.

Dependencies are pinned directly; no lockfile supplied. First CI installs with npm install, records its dependency tree and uploads the generated lockfile for review. Commit a reviewed lockfile then switch to npm ci. Transitive reproducibility remains unresolved until then.

Worker accepts authorized HTML text, rejects large inputs, validates literal evidence and estimates configured token/fixed-job costs. Regex HTML stripping is not a production parser. No annualization, seat minima, region handling or monitoring. Evidence presence does not prove semantics. Preflight budget reservation is heuristic, not a provider-enforced cap. No retries or automatic live entrypoint. Paid adapter use requires explicit authorization, actual applicable model/rates and approved data transfer. CI has no model credentials and never invokes live transport.

Audit callback is required, but is not a transactional billing ledger. It logs usage before result validation. Failed transport/absent usage leaves billing unknown. Audit failure after a paid request can lose cost evidence. Reconcile provider invoices; do not automatically refund/retry unknown outcomes.

Next service phase, after validated baseline: PostgreSQL tenants, hashed/revocable scoped credentials, idempotent job keys plus payload fingerprints, atomic credit reservations, unique grants, durable job leases with fencing, private result references, transactional outbox and reconciliation. Do not treat ambiguous provider outcomes as safe to repeat. No customer balance is reduced merely because this library returns completed.

Checkout remains closed until sandbox payment-to-grant-to-job-to-result, cross-tenant denial, retry safety, crash recovery and reconciliation pass. Pricing/product changes and production activation require separate approval.
