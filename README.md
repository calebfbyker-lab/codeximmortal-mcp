# CodexImmortal MCP

Public agent-discovery and product documentation for [CodexImmortal](https://codeximmortal.com).

## Buy with your agent

Ask your agent to inspect the CodexImmortal catalog, compare the products with your requirements, and return the appropriate one-time checkout link.

[Buyer guide](docs/buyer-guide.md) | [Machine-readable catalog](catalog.json)

## Products and hosted checkout

All prices below are one-time payments in USD, not subscriptions. Scope descriptions are merchant catalog descriptions, not independent verification of delivery. Confirm license, fulfillment, support, refund terms and any applicable tax before paying. One-time payment does not promise lifetime access or updates.

| Product | Stated scope | One-time USD | Stripe checkout |
|---|---|---:|---|
| AI Workflow Launch Kit | Core module map, activation checklist, workflow starter blueprint | $50 | [Checkout](https://buy.stripe.com/bJe3cw0yhbt59QBdiL3oA0c) |
| Decision Review Workspace | Council configuration with 250 mission decision cycles | $399 | [Checkout](https://buy.stripe.com/3cIaEY4Ox68L7It3Ib3oA0d) |
| AI Implementation Blueprint | Implementation blueprint covering orchestration, operations, memory and governance | $500 | [Checkout](https://buy.stripe.com/9B63cwgxfdBdd2N0vZ3oA0m) |
| MCP Integration Kit | SDK package and integration guide | $750 | [Checkout](https://buy.stripe.com/28EaEY80Jcx92o9diL3oA0e) |
| Agent Evaluation Lab | Lab configuration and 25 simulations | $1,200 | [Checkout](https://buy.stripe.com/3cI7sM0yh8gTfaV4Mf3oA0f) |
| Revenue Operations Workspace | Ledger and receipt-proof workspace | $1,500 | [Checkout](https://buy.stripe.com/7sYcN66WFfJlbYJ3Ib3oA0g) |
| Agent Workflow Launch | Workflow build with five agents and 500 runs | $1,500 | [Checkout](https://buy.stripe.com/5kQ14obcV54HbYJ2E73oA0h) |
| Security Hardening Package | Security and compliance posture package | $2,400 | [Checkout](https://buy.stripe.com/00w4gAa8R54H7It92v3oA0i) |
| Agent Knowledge Hub | Graph deployment and 10,000 indexed records | $2,500 | [Checkout](https://buy.stripe.com/5kQ6oI3KtfJl9QBfqT3oA0j) |
| Bitcoin Transaction Controls | PSBT and multisig operations workspace | $3,000 | [Checkout](https://buy.stripe.com/8x214oftb1Sv7It92v3oA0k) |
| Multi-Node Coordination Setup | Three-peer federation configuration | $5,000 | [Checkout](https://buy.stripe.com/14AeVegxfbt53sdemP3oA0l) |

Payment links were created in Stripe live mode. Opening a link does not charge a customer; completing checkout can. Hosted payment availability is not proof that fulfillment or autonomous purchasing is implemented.

## Agent surfaces

- Static catalog (primary, always on): https://calebfbyker-lab.github.io/codeximmortal-mcp/catalog.json
- Static buyer guide: https://calebfbyker-lab.github.io/codeximmortal-mcp/docs/buyer-guide.md
- Remote MCP wire endpoint: https://codeximmortal-mcp.onrender.com/mcp
- Health route: https://codeximmortal-mcp.onrender.com/healthz

The static surfaces are served by GitHub Pages and are always available. The MCP endpoint runs on a Render free-tier instance: it spins down when idle and may take time to wake; if it is unreachable, use the static catalog and this README. MCP wire methods are `tools/list` and `tools/call`. Catalog handlers are implemented locally; other tool handlers proxy to a separately configured gateway. Catalog JSON (v1.2.3) embeds a `checkout_url` for each offer; the table and buyer guide mirror the same links.

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

Published in the official MCP Registry as `io.github.calebfbyker-lab/codeximmortal`, version `1.1.0`. The registry response checked on November 7, 2026 reports status `active`, `isLatest: true`, and publication at `2026-11-07T15:03:51.99961Z`.

Registry lookup:
https://registry.modelcontextprotocol.io/v0/servers?search=codeximmortal

The live remote endpoint passed MCP initialization and `tools/list`, returning all six advertised tools on November 7, 2026. End-to-end `tools/call` verification remains pending. Registry publication is a discoverability milestone, not security certification, government endorsement, or verification of tool execution or payment functionality.

Share the buyer guide and MCP connection URL with relevant developers and agent operators. Profile and educational-post copy is provided in the buyer guide for separate review.

Platform: https://codeximmortal.com
Repository: https://github.com/calebfbyker-lab/codeximmortal-mcp
License: UNLICENSED.
