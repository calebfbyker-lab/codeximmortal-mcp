# CodexImmortal MCP

Public agent-discovery and product documentation for [CodexImmortal](https://codeximmortal.com).

## Buy with your agent

Ask your agent to inspect the CodexImmortal catalog, compare the products with your requirements, and return the appropriate one-time checkout link.

[Buyer guide](docs/buyer-guide.md) | [Machine-readable catalog](catalog.json)

## Products and storefront checkout

This MCP server exposes the CodexImmortal storefront catalog; it is not a separate product catalog. The table below reflects catalog v1.2.4 and its $49–$449 pricing. Links open storefront product pages, where server-priced checkout is offered; they are not direct hosted Stripe payment links.

All prices below are one-time payments in USD, not subscriptions. Scope descriptions are merchant catalog descriptions, not independent verification of delivery. Confirm license, fulfillment, support, refund terms and any applicable tax before paying. One-time payment does not promise lifetime access or updates.

| Product | Stated scope | One-time USD | Storefront product page |
|---|---|---:|---|
| AI Workflow Launch Kit | Core module map, activation checklist, workflow starter blueprint | $49 | [View product](https://codeximmortal.com/products/starter-kit) |
| Decision Review Workspace | Council configuration with 250 decision cycles | $199 | [View product](https://codeximmortal.com/products/ai-council-orchestration) |
| AI Implementation Blueprint | Implementation blueprint covering orchestration, operations, memory and governance | $149 | [View product](https://codeximmortal.com/products/deployment-blueprint) |
| MCP Integration Kit | SDK package and integration guide | $249 | [View product](https://codeximmortal.com/products/mcp-sdk) |
| Agent Evaluation Lab | Lab configuration and 25 evaluations | $249 | [View product](https://codeximmortal.com/products/operations-lab) |
| Revenue Operations Workspace | Ledger and receipt-proof workspace | $299 | [View product](https://codeximmortal.com/products/revenue-studio) |
| Agent Workflow Launch | Workflow build with five agents and 500 runs | $349 | [View product](https://codeximmortal.com/products/agentic-orchestration) |
| Security Hardening Package | Security and compliance posture package | $399 | [View product](https://codeximmortal.com/products/omniseal-defense) |
| Agent Knowledge Hub | Graph deployment and 10,000 indexed records | $349 | [View product](https://codeximmortal.com/products/sovereign-memory-graph) |
| Bitcoin Transaction Controls | PSBT and multisig operations workspace | $399 | [View product](https://codeximmortal.com/products/bitcoin-wealth-engine) |
| Multi-Node Coordination Setup | Three-peer federation configuration | $449 | [View product](https://codeximmortal.com/products/federation-consensus) |

The prior $50–$5,000 catalog snapshot and its hosted buy.stripe.com links are retired from the current catalog. This documentation update does not deactivate any legacy Stripe links; any still-active legacy links require an owner audit in Stripe before deactivation. Opening a product page does not charge a customer; completing checkout can. Checkout availability is not proof that fulfillment or autonomous purchasing is implemented.

## Agent surfaces

- Static catalog (primary, always on): https://calebfbyker-lab.github.io/codeximmortal-mcp/catalog.json
- Static buyer guide: https://calebfbyker-lab.github.io/codeximmortal-mcp/docs/buyer-guide.md
- Remote MCP wire endpoint: https://codeximmortal-mcp.onrender.com/mcp
- Health route: https://codeximmortal-mcp.onrender.com/healthz

The static surfaces are served by GitHub Pages and are always available. The MCP endpoint runs on a Render free-tier instance: it spins down when idle and may take time to wake; if it is unreachable, use the static catalog and this README. MCP wire methods are `tools/list` and `tools/call`. Catalog handlers are implemented locally; other tool handlers proxy to a separately configured gateway. Catalog JSON (v1.2.4) embeds a storefront product-page `checkout_url` for each offer; the table above mirrors those links. The buyer guide is a separate document and has not been reverified for catalog alignment in this update.

## Tool status

| Tool | Implementation status |
|---|---|
| codex_catalog_list | Live end-to-end tools/call verified on November 7, 2026 with category=all; returned catalog v1.2.4 with 11 offers and no MCP tool error |
| codex_catalog_get_product | Local product handler; end-to-end verification pending |
| codex_quote_request | Gateway-dependent; not verified operational |
| codex_attestation_verify | Gateway-dependent; not verified operational |
| codex_scan_request | Gateway-dependent; not verified operational |
| codex_purchase_initiate | Gateway-dependent; no verified autonomous live payment execution |

The catalog-list test verifies retrieval for the tested request, not every category filter, checkout execution, fulfillment, or merchant claims.

## Governance and release status

UNCERTIFIED. CI-059 dependency is PROVISIONAL; CI-043 status is Active according to project instructions, not a fresh registry audit. No payment credentials belong in this repository or agent prompts. Automated financial execution remains disabled; storefront checkout is a separate payment surface. This repository does not establish AP2, ACP, x402 or A2A runtime compatibility, government authorization, security certification, or guaranteed revenue.

## Distribution

Published in the official MCP Registry as `io.github.calebfbyker-lab/codeximmortal`, version `1.1.0`. The registry response checked on November 7, 2026 reports status `active`, `isLatest: true`, and publication at `2026-11-07T15:03:51.99961Z`.

Registry lookup:
https://registry.modelcontextprotocol.io/v0/servers?search=codeximmortal

The live remote endpoint passed MCP initialization and `tools/list`, returning all six advertised tools on November 7, 2026. A subsequent `tools/call` to `codex_catalog_list` with `category: all` returned catalog v1.2.4 with 11 offers and no MCP tool error. Other tool invocations remain unverified. Registry publication is a discoverability milestone, not security certification, government endorsement, or verification of payment functionality.

Share the buyer guide and MCP connection URL with relevant developers and agent operators. Profile and educational-post copy is provided in the buyer guide for separate review.

Platform: https://codeximmortal.com
Repository: https://github.com/calebfbyker-lab/codeximmortal-mcp
License: UNLICENSED.
