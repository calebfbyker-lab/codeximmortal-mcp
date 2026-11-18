# Catalog and buyer-path audit

Read-only audit and proposed documentation/testing increment. Existing catalog version: 1.2.5. No prices, price IDs, checkout URLs, capacity, renewal, expiry, license, support or refund terms changed. catalog.json, server.json, glama.json and mcp-manifest.json are deliberately untouched.

Findings:
- Twelve offers exist: eleven storefront module offers plus Web-to-JSON 50. Product-page checkout URLs are not direct Stripe links or autonomous payment APIs.
- Buyer guide said Starter Kit $50 and Blueprint $500, while catalog says $49 and $149. Correct documentation to existing catalog terms, not the reverse.
- Buyer guide referenced a nonexistent README checkout-table anchor. Replace it with catalog-backed guidance.
- Catalog advertises test mode, disabled payouts and UNCERTIFIED validation. Merchant deliverable/instant-delivery/production-ready descriptions are not independently verified capabilities.
- Web-to-JSON 50 is $10, Base44-hosted checkout/delivery, with no Render/MCP bundle execution. It must not be conflated with the three planned standalone services or the narrower x402 provider.
- mcp-manifest server transport URL differs from server.json. Its OAuth/stdio/package/gateway/metering/audit descriptions require separate correction against runtime evidence. This patch explicitly does not certify those claims or silently edit discoverability metadata.

Real external observation:
Glama page https://glama.ai/mcp/connectors/io.github.calebfbyker-lab/codeximmortal was retrieved on 2026-11-15. It reported Ownership verified, Healthy, six tools and last tested 2026-11-10 05:29 (timezone unspecified). The dashboard displays these as recorded Glama-reported labels, not an independent current endpoint check. No observed official Registry entry is asserted. Recorded page text is not an externally signed publication receipt or customer-demand evidence.

Remote verification limitation:
Assistant fetch attempts for the documented health and catalog endpoints failed. This does not prove the server is down. No SDK client process ran in the assistant environment. Reuse the strengthened existing mcp-smoke-test.mjs locally: it reads server.json, initializes with the installed MCP SDK, lists tools and calls only the two catalog tools, comparing basic catalog fields with the local baseline. It never invokes quote, scan, purchase or payment tools. A failure can indicate remote/local catalog drift, not just connectivity. It emits a sanitized JSON report with deployedCommit unknown. Retain tested local SHA and runtime separately. This is read-only protocol/catalog verification, not authenticated purchasing or fulfillment verification.

Tests authored, not executed: src/buyer-surface-consistency.test.ts plus existing catalog/manifest/distribution/Orders suites. Tests protect selected cross-file contracts and the fixed catalog price baseline; they are not exhaustive official schema validation, complete terms locking or a resolution of the legacy manifest drift. New listing snapshot is manually recorded public evidence, not a polling adapter. Runtime reads local files and makes no new external network calls.

Separate approval required for manifest identity/endpoint/capability corrections that alter advertised metadata, any registry publish/claim flow or external listing changes, commercial term changes, payment activation and deployment. Updating buyer docs in GitHub is itself part of the reviewed repository write. No external publication API is called by this increment.
