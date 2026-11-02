# CodexImmortal MCP

Public agent-discovery and product documentation for [CodexImmortal](https://codeximmortal.com).

## Buy with your agent

Ask your agent to inspect the CodexImmortal catalog, compare the products with your requirements, and return the appropriate product page for one-time checkout.

[Buyer guide](docs/buyer-guide.md) | [Machine-readable catalog](catalog.json)

## Products and checkout

All prices below are one-time payments in USD, matching the storefront's owner-approved 2026 fee ladder exactly (Stripe-verified 2026-10-31). Scope descriptions are merchant catalog descriptions, not independent verification of delivery. Confirm license, fulfillment, support, refund terms and any applicable tax before paying. One-time payment does not promise lifetime access or updates.

| Product | Stated scope | One-time USD | Product page |
|---|---|---:|---|
| AI Workflow Launch Kit | Core module map, activation checklist, workflow starter blueprint | $49 | [Product page](https://codeximmortal.com/products/starter-kit) |
| Decision Review Workspace | Council configuration with 250 mission decision cycles | $199 | [Product page](https://codeximmortal.com/products/ai-council-orchestration) |
| AI Implementation Blueprint | Implementation blueprint covering orchestration, operations, memory and governance | $149 | [Product page](https://codeximmortal.com/products/deployment-blueprint) |
| MCP Integration Kit | SDK package and integration guide | $249 | [Product page](https://codeximmortal.com/products/mcp-sdk) |
| Agent Evaluation Lab | Lab configuration and 25 evaluations | $249 | [Product page](https://codeximmortal.com/products/operations-lab) |
| Revenue Operations Workspace | Ledger and receipt-proof workspace | $299 | [Product page](https://codeximmortal.com/products/revenue-studio) |
| Agent Workflow Launch | Workflow build with five agents and 500 runs | $349 | [Product page](https://codeximmortal.com/products/agentic-orchestration) |
| Security Hardening Package | Security and compliance posture package | $399 | [Product page](https://codeximmortal.com/products/omniseal-defense) |
| Agent Knowledge Hub | Graph deployment and 10,000 indexed records | $349 | [Product page](https://codeximmortal.com/products/sovereign-memory-graph) |
| Bitcoin Transaction Controls | PSBT and multisig operations workspace | $399 | [Product page](https://codeximmortal.com/products/bitcoin-wealth-engine) |
| Multi-Node Coordination Setup | Three-peer federation configuration | $449 | [Product page](https://codeximmortal.com/products/federation-consensus) |

Checkout is offered only on the product pages via the storefront's server-priced checkout: the published fee is resolved server-side and charged exactly once. Legacy hosted buy.stripe.com links from the retired $50–$5,000 price ladder are no longer referenced by this surface and must not be used; any still-active legacy links are pending an owner audit in Stripe.

## Agent surfaces

- Static catalog (primary, always on): https://calebfbyker-lab.github.io/codeximmortal-mcp/catalog.json
- Static buyer guide: https://calebfbyker-lab.github.io/codeximmortal-mcp/docs/buyer-guide.md
- Remote MCP wire endpoint: https://codeximmortal-mcp.onrender.com/mcp
- Health route: https://codeximmortal-mcp.onrender.com/healthz

The static surfaces are served by GitHub Pages and are always available. The MCP endpoint runs on a Render free-tier instance: it spins down when idle and may take time to wake; if it is unreachable, use the static catalog and this README. MCP wire methods are `tools/list` and `tools/call`. Catalog handlers are implemented locally; other tool handlers proxy to a separately configured gateway. Catalog JSON (v1.2.4) embeds a `checkout_url` (product page) for each offer; the table and buyer guide mirror the same routes.

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

UNCERTIFIED. CI-059 dependency is PROVISIONAL; CI-043 status is Active according to project instructions, not a fresh registry audit. No payment credentials belong in this repository or agent prompts. Automated financial execution remains disabled. This repository does not establish AP2, ACP, x402 or A2A runtime compatibility, government authorization, security certification, or guaranteed revenue.

## Distribution

Directory submission and acceptance are not confirmed. Share the buyer guide and MCP connection URL with relevant developers and agent operators; do not represent a directory listing as already published. Profile and educational-post copy is provided in the buyer guide for separate review.

Platform: https://codeximmortal.com
Repository: https://github.com/calebfbyker-lab/codeximmortal-mcp
License: UNLICENSED.
