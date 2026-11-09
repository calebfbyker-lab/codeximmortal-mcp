# CodexImmortal MCP

Public agent-discovery and product surface for CodexImmortal (https://codeximmortal.com). Registered in the official MCP Registry as `io.github.calebfbyker-lab/codeximmortal` — active, published 2026-11-07.

## Buy with your agent

Ask your agent to inspect the CodexImmortal catalog, compare the products with your requirements, and return the appropriate checkout link.

[Buyer guide](https://calebfbyker-lab.github.io/codeximmortal-mcp/docs/buyer-guide.md) | [Machine-readable catalog](https://calebfbyker-lab.github.io/codeximmortal-mcp/catalog.json)

## Products and hosted checkout

All prices below are one-time payments in USD, not subscriptions. Scope descriptions are merchant catalog descriptions, not independent verification of delivery. Confirm license, fulfillment, support, refund terms and any applicable tax before paying. One-time payment does not promise lifetime access or updates.

| Product | Stated scope | One-time USD | Product page |
|--|--|--|--|
| AI Workflow Launch Kit | Core module map, activation checklist, and workflow starter blueprint | $49 | [Product page](https://codeximmortal.com/products/starter-kit) |
| AI Implementation Blueprint | Implementation blueprint covering orchestration, operations, memory and governance | $149 | [Product page](https://codeximmortal.com/products/deployment-blueprint) |
| Decision Review Workspace | Council configuration with 250 mission decision cycles | $199 | [Product page](https://codeximmortal.com/products/ai-council-orchestration) |
| MCP Integration Kit | SDK package and integration guide | $249 | [Product page](https://codeximmortal.com/products/mcp-sdk) |
| Agent Evaluation Lab | Lab configuration and 25 evaluations | $249 | [Product page](https://codeximmortal.com/products/operations-lab) |
| Revenue Operations Workspace | Ledger and receipt-proof workspace | $299 | [Product page](https://codeximmortal.com/products/revenue-studio) |
| Agent Workflow Launch | Workflow build with five agents and 500 runs | $349 | [Product page](https://codeximmortal.com/products/agentic-orchestration) |
| Agent Knowledge Hub | Graph deployment and 10,000 indexed records | $349 | [Product page](https://codeximmortal.com/products/sovereign-memory-graph) |
| Security Hardening Package | Security and compliance posture package | $399 | [Product page](https://codeximmortal.com/products/omniseal-defense) |
| Bitcoin Transaction Controls | PSBT and multisig operations workspace | $399 | [Product page](https://codeximmortal.com/products/bitcoin-wealth-engine) |
| Multi-Node Coordination Setup | Delivered three-peer federation configuration | $449 | [Product page](https://codeximmortal.com/products/federation-consensus) |
| Codex Web-to-JSON — Evaluation Bundle | 50 prepaid supported public pricing-page extractions into structured plan data with source evidence | $10 | [Product page](https://codeximmortal.com/products/web-to-json) |

Catalog checkout URLs lead to storefront product pages with server-priced checkout. Opening a page does not charge a customer; completing checkout can. Hosted payment availability is not proof that fulfillment or autonomous purchasing is implemented. The Web-to-JSON bundle uses a human-authorized hosted checkout (the storefront's checkout function, called with the buyer's email); machine purchase and automatic replenishment are not supported.

## Web-to-JSON API

- Documentation: https://codeximmortal.com/products/web-to-json/docs
- Purchase contract: https://codeximmortal.com/web-to-json-purchase-contract.md

Delivery uses a buyer-scoped API key with 50 supported page extractions and no credit expiry. Render/MCP execution is not connected to this prepaid bundle and end-to-end validation is pending (`UNCERTIFIED`). Agents must not collect or relay card data; the buyer authorizes payment directly on the hosted checkout.

## Agent surfaces

- Static catalog (primary, always on): https://calebfbyker-lab.github.io/codeximmortal-mcp/catalog.json (v1.2.5, twelve offers)
- Static buyer guide: https://calebfbyker-lab.github.io/codeximmortal-mcp/docs/buyer-guide.md
- Remote MCP wire endpoint: https://codeximmortal-mcp.onrender.com/mcp
- Health route: https://codeximmortal-mcp.onrender.com/healthz
- Official MCP Registry entry: `io.github.calebfbyker-lab/codeximmortal` (active, published 2026-11-07)

The static surfaces are served by GitHub Pages and are always available. The MCP endpoint runs on a Render free-tier instance: it spins down when idle and may take time to wake; if it is unreachable, use the static catalog and this README. MCP wire methods are `tools/list` and `tools/call`. Catalog handlers are implemented locally; other tool handlers proxy to a separately configured gateway. Catalog JSON (v1.2.5) embeds a `checkout_url` for each offer; the table and buyer guide mirror the same links.

## Tool status

| Tool | Implementation status |
|--|--|
| codex_catalog_list | Local catalog handler; end-to-end verification pending |
| codex_catalog_get_product | Local product handler; end-to-end verification pending |
| codex_quote_request | Gateway-dependent; not verified operational |
| codex_attestation_verify | Gateway-dependent; not verified operational |
| codex_scan_request | Gateway-dependent; not verified operational |
| codex_purchase_initiate | Gateway-dependent; no verified autonomous live payment execution |

## Governance and release status

UNCERTIFIED. CI-059 dependency is PROVISIONAL; CI-043 status is Active according to project instructions, not a fresh registry audit. No payment credentials belong in this repository or agent prompts. Automated financial execution remains disabled; the storefront's hosted checkout is the only referenced payment surface. This repository does not establish AP2, ACP, x402 or A2A runtime compatibility, government authorization, security certification, or guaranteed revenue.

## Distribution

Published to the official MCP Registry on 2026-11-07 as `io.github.calebfbyker-lab/codeximmortal` (status: active, version 1.1.0). Third-party directory listings (Glama, PulseMCP, mcp.directory and others) are not confirmed as of this commit; do not represent them as published. `glama.json` is included to support a Glama maintainer claim.

Platform: https://codeximmortal.com
Repository: https://github.com/calebfbyker-lab/codeximmortal-mcp
License: UNLICENSED.
