# CodexImmortal MCP

Public agent-discovery and product documentation for [CodexImmortal](https://codeximmortal.com).

## Buy with your agent

Ask your agent to inspect the CodexImmortal catalog, compare the products with your requirements, and return the appropriate one-time checkout link.

[Buyer guide](docs/buyer-guide.md) | [Machine-readable catalog](catalog.json)

## Products and hosted checkout

All prices below are one-time payments in USD, not subscriptions. Scope descriptions are merchant catalog descriptions, not independent verification of delivery. Confirm license, fulfillment, support, refund terms and any applicable tax before paying. One-time payment does not promise lifetime access or updates.

| Product | Stated scope | One-time USD | Stripe checkout |
|---|---|---:|---|
| Core Agentic Modules Starter Kit | Core module map, activation checklist, workflow starter blueprint | $50 | [Checkout](https://buy.stripe.com/bJe3cw0yhbt59QBdiL3oA0c) |
| AI Council Orchestration Module | Council configuration with 250 mission decision cycles | $399 | [Checkout](https://buy.stripe.com/3cIaEY4Ox68L7It3Ib3oA0d) |
| Core Agentic Modules Deployment Blueprint | Implementation blueprint covering orchestration, operations, memory and governance | $500 | [Checkout](https://buy.stripe.com/9B63cwgxfdBdd2N0vZ3oA0m) |
| MCP SDK Module | SDK package and integration guide | $750 | [Checkout](https://buy.stripe.com/28EaEY80Jcx92o9diL3oA0e) |
| Operations Lab Module | Lab configuration and 25 simulations | $1,200 | [Checkout](https://buy.stripe.com/3cI7sM0yh8gTfaV4Mf3oA0f) |
| Revenue Studio Module | Ledger and receipt-proof workspace | $1,500 | [Checkout](https://buy.stripe.com/7sYcN66WFfJlbYJ3Ib3oA0g) |
| Agentic Orchestration Module | Workflow build with five agents and 500 runs | $1,500 | [Checkout](https://buy.stripe.com/5kQ14obcV54HbYJ2E73oA0h) |
| Omniseal Defense Module | Security and compliance posture package | $2,400 | [Checkout](https://buy.stripe.com/00w4gAa8R54H7It92v3oA0i) |
| Sovereign Memory Graph Module | Graph deployment and 10,000 indexed records | $2,500 | [Checkout](https://buy.stripe.com/5kQ6oI3KtfJl9QBfqT3oA0j) |
| Bitcoin Wealth Engine Module | PSBT and multisig operations workspace | $3,000 | [Checkout](https://buy.stripe.com/8x214oftb1Sv7It92v3oA0k) |
| Federation Consensus Module | Three-peer federation configuration | $5,000 | [Checkout](https://buy.stripe.com/14AeVegxfbt53sdemP3oA0l) |

Payment links were created in Stripe live mode. Opening a link does not charge a customer; completing checkout can. Hosted payment availability is not proof that fulfillment or autonomous purchasing is implemented. The two mistakenly created Pro recurring links have been deactivated.

## MCP connection for developers and agent operators

- Streamable HTTP endpoint: https://codeximmortal-mcp.onrender.com/mcp
- Public catalog route: https://codeximmortal-mcp.onrender.com/api/v1/catalog.json
- Health route: https://codeximmortal-mcp.onrender.com/healthz

Use your client's remote Streamable HTTP connection settings. Endpoint deployment has previously been reported live by Render; current end-to-end MCP interoperability and checkout fulfillment have not been verified. Do not assume a successful health response proves tools work.

MCP wire methods are `tools/list` and `tools/call`. Catalog handlers are implemented locally; other tool handlers proxy to a separately configured gateway. Catalog JSON does not yet embed these checkout URLs; use the table or buyer guide for them. No published npm package installation is verified.

## Tool status

| Tool | Implementation status |
|---|---|
| codex_catalog_list | Local catalog handler; end-to-end verification pending |
| codex_catalog_get_product | Local product handler; end-to-end verification pending |
| codex_quote_request | Gateway-dependent; not verified operational |
| codex_attestation_verify | Gateway-dependent; not verified operational |
| codex_scan_request | Gateway-dependent; not verified operational |
| codex_purchase_initiate | Gateway-dependent; no verified autonomous live payment execution |

## Governance and release status

UNCERTIFIED. CI-059 dependency is PROVISIONAL; CI-043 status is Active according to project instructions, not a fresh registry audit. No payment credentials belong in this repository or agent prompts. Automated financial execution remains disabled; hosted Stripe links are separate live checkout surfaces. This repository does not establish AP2, ACP, x402 or A2A runtime compatibility, government authorization, security certification, or guaranteed revenue.

## Distribution

Directory submission and acceptance are not confirmed. Share the buyer guide and MCP connection URL with relevant developers and agent operators; do not represent a directory listing as already published. Profile and educational-post copy is provided in the buyer guide for separate review.

Platform: https://codeximmortal.com
Repository: https://github.com/calebfbyker-lab/codeximmortal-mcp
License: UNLICENSED.
