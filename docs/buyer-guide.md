# CodexImmortal buyer and agent operator guide

## Scope and authority

Use catalog.json for offer IDs, prices, Stripe price references and purchase destinations. The table below mirrors catalog version 1.2.5; it does not create new terms. All twelve catalog offers remain UNCERTIFIED. Product descriptions are merchant claims, not proof of delivery, certification or fitness. The catalog declares payment mode test and live payouts disabled; do not infer that any linked storefront checkout is live or verified.

## Offers and one-time catalog prices

| Product ID | Product | USD | Published scope and limitations |
|---|---|---:|---|
| `federation-consensus` | Multi-Node Coordination Setup | $449.00 | Delivered three-peer federation configuration. |
| `bitcoin-wealth-engine` | Bitcoin Transaction Controls | $399.00 | Delivered PSBT and multisig operations workspace. |
| `sovereign-memory-graph` | Agent Knowledge Hub | $349.00 | Delivered graph deployment and 10,000 indexed records. |
| `omniseal-defense` | Security Hardening Package | $399.00 | Delivered security and compliance posture package. |
| `revenue-studio` | Revenue Operations Workspace | $299.00 | Delivered ledger and receipt-proof workspace. |
| `agentic-orchestration` | Agent Workflow Launch | $349.00 | Delivered workflow build with 5 agents and 500 runs. |
| `operations-lab` | Agent Evaluation Lab | $249.00 | Delivered lab configuration and 25 evaluations. |
| `mcp-sdk` | MCP Integration Kit | $249.00 | Delivered SDK package and integration guide. |
| `ai-council-orchestration` | Decision Review Workspace | $199.00 | Delivered council configuration with 250 decision cycles. |
| `deployment-blueprint` | AI Implementation Blueprint | $149.00 | Implementation blueprint covering orchestration, operations, memory, and governance; merchant production-readiness claim is not independently verified. |
| `starter-kit` | AI Workflow Launch Kit | $49.00 | Core module map, activation checklist, and workflow starter blueprint; instant-delivery claim requires fulfillment verification. |
| `web-to-json-50` | Web-to-JSON Evaluation Bundle | $10.00 | 50 supported public software pricing-page extractions; Base44 fulfillment, not connected to Render/MCP execution. |

## Purchase paths

### Eleven storefront module offers

The checkout_url on each catalog record is a product page, not a direct Stripe payment link or autonomous purchase API. Read that page and resolve scope, licensing, timing, support, refund terms and tax with the merchant before authorizing hosted checkout. Preserve the fixed Stripe price references in catalog.json; agents must not invent or substitute price IDs. No subscriptions are offered here. One-time payment does not promise lifetime access or updates. A payment receipt is not proof of delivery.

### Web-to-JSON Evaluation Bundle

The catalog states a one-time $10.00 USD purchase for 50 supported page extractions, no automatic renewal, top-up, or credit expiry. Commercial values are server-owned inline Stripe price_data, not a fixed price ID. Its human-authorized hosted-checkout function requires an email; this guide does not invoke it or authorize sending personal data. See the catalog's documentation_url and purchase_contract_url. Buyer-scoped Base44 API-key delivery is separate from MCP authentication. Render/MCP execution is not connected to this prepaid bundle; end-to-end validation remains pending. Do not enter buyer keys in agent prompts or claim this bundle funds the standalone commerce wallet.

### Three proposed standalone services

pricing_snapshot, pricing_compare and document_extract are a separate planned/unpublished service registry. They are not additional purchasable offers in this twelve-offer storefront catalog. Their quote/job backend does not establish production availability, approved prices or delivery. Do not route an existing storefront purchase into their balances or jobs without a separately approved integration.

## Public discovery and safe examples

Remote MCP target (matches server.json):

```text
https://codeximmortal-mcp.onrender.com/mcp
```

Public catalog target:

```text
https://codeximmortal-mcp.onrender.com/api/v1/catalog.json
```

Connect through a client's supported Streamable HTTP transport and initialization flow. These are read-only application request examples, not a replacement for the transport handshake:

```json
{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}
```

```json
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"codex_catalog_list","arguments":{"category":"all"}}}
```

The current source handler returns catalog_version, count and offers. Each offer includes offer_id, product_id, title, description, checkout_url and pricing. The catalog response does not prove payment or availability.

```json
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"codex_catalog_get_product","arguments":{"offer_id":"offer-core-agentic-modules-starter-kit"}}}
```

The expected source-level result is the matching catalog record: product_id starter-kit, amount_minor 4900, currency USD, one-time pricing, and its product-page checkout_url. This example is not an observed remote response. The implementation also accepts product_id, but offer_id is the documented request field.

Catalog list and product detail resolve locally in source. Quote requests, purchase proposals, attestation verification and scan requests use a separate configured gateway; they are not verified payment or fulfillment capabilities. Do not call those tools during read-only discovery testing. Never use the gateway-private mcp.tools.call method as the public MCP method.

## Verification and known metadata drift

Run node mcp-smoke-test.mjs from a reviewed checkout to test the remote SDK client. It initializes, lists tools, and calls only catalog list and product detail. No purchase, quote, scan or payment call is made. A result belongs to the time and endpoint tested, not an inferred deployed commit.

The legacy mcp-manifest.json server block still advertises https://mcp.codeximmortal.com/mcp and includes broad OAuth, metering, gateway and attestation claims. Those differ from server.json or exceed the verification established here. Metadata correction/publication requires separate review; the tests in this increment do not certify those claims. The legacy guide's README anchor was absent and its $50 Starter Kit / $500 Blueprint amounts conflicted with the catalog; this guide corrects documentation to the existing $49/$149 catalog amounts without changing catalog terms.

Glama listing evidence is recorded separately in docs/distribution-observations.json. Third-party health and ownership labels are not independent verification, customer demand or commercial authorization. No official Registry publication, external listing edit, live purchase, charge, fulfillment or release approval is performed by this guide.
