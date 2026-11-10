# CodexImmortal MCP

Model Context Protocol integration and machine-readable product discovery for CodexImmortal.

This repository provides a product catalog, buyer guidance, and an MCP server implementation. Catalog tools resolve locally; other advertised tools depend on a separate gateway. Prepaid Web-to-JSON delivery through MCP is not available in this branch and remains subject to authentication, buyer-isolation, and end-to-end release verification.

## Overview

Use this repository to:

- Discover CodexImmortal products and their published scope.
- Compare offers through the machine-readable catalog.
- Direct buyers to product pages for human-authorized checkout.
- Develop and evaluate the MCP integration against documented release gates.

Product descriptions are merchant statements, not independent evidence of fulfillment, certification, or fitness for a particular use.

## Capability status

| Capability | Implementation | Verification boundary |
| --- | --- | --- |
| Product catalog | Static catalog and local MCP catalog handlers | Live client interoperability is not established by this document |
| Product details | Local product lookup handler | Offer terms must be reviewed before purchase |
| Quotes, attestations, and scan requests | Gateway forwarding path | Upstream operation and authorization require separate verification |
| Purchase proposals | Gateway-dependent tool | No verified autonomous live payment execution |
| Prepaid Web-to-JSON over MCP | Not connected in this branch | Release blocked pending buyer authorization and delivery evidence |
| Prepaid HTTPS adapter | Separate HTTP router in source | Activation and end-to-end behavior require deployment verification |

The source implementation, a deployed endpoint, and a verified customer outcome are different evidence levels. This repository does not establish a security certification, government authorization, service-level agreement, or guaranteed revenue.

## Products and purchasing

The [machine-readable catalog](catalog.json) contains the published offers, one-time USD prices, and product-page checkout URLs. The [buyer guide](docs/buyer-guide.md) explains the purchasing workflow. Product prices and checkout destinations are not changed by this documentation update.

1. Review the offer scope and validation status.
2. Open the catalog's product-page URL.
3. Confirm fulfillment, licensing, support, refund terms, and applicable tax.
4. The buyer authorizes payment directly through hosted checkout.

Opening a product page does not charge a customer. Completing checkout can. A one-time payment does not imply lifetime access or updates. Hosted checkout availability does not prove product fulfillment or autonomous purchasing. Agents must not collect card details, delivery tokens, or buyer API keys in prompts.

### Web-to-JSON

The catalog describes an Evaluation Bundle of 50 prepaid supported public pricing-page extractions. Review the current purchase contract and product documentation before purchase:

- Product documentation: https://codeximmortal.com/products/web-to-json/docs
- Purchase contract: https://codeximmortal.com/web-to-json-purchase-contract.md

The buyer-scoped HTTPS delivery mechanism is separate from MCP authentication. MCP delivery is not advertised as operational. Automatic purchasing and replenishment are outside this release scope.

## Integration entry points

| Surface | Location |
| --- | --- |
| Catalog source | [catalog.json](catalog.json) |
| Published catalog | https://calebfbyker-lab.github.io/codeximmortal-mcp/catalog.json |
| Buyer guide | [docs/buyer-guide.md](docs/buyer-guide.md) |
| Documented MCP endpoint | https://codeximmortal-mcp.onrender.com/mcp |
| Documented health endpoint | https://codeximmortal-mcp.onrender.com/healthz |
| Tool definitions | [mcp-manifest.json](mcp-manifest.json) |

Endpoint URLs are documented integration targets, not uptime guarantees. Hosting configuration and endpoint availability must be checked separately. If the MCP endpoint is unavailable, consult the published catalog or repository copy. A successful health response is not proof of authenticated delivery.

## Local development

Use Node.js 22 or later, consistent with package.json. Review environment configuration before starting the server.

```sh
npm install --no-audit --no-fund
npm test
npm run build
```

For a reviewed environment, `npm start` runs the HTTP entry point and `npm run start:stdio` runs the stdio entry point. Do not supply production credentials to local tests or enable payment handling for routine development. Dependency installation is not a security audit.

## Engineering documentation

- [Architecture](docs/architecture.md)
- [Release status and verification](docs/release-status.md)
- [Contribution guidelines](CONTRIBUTING.md)

The buyer-authentication implementation branch is separate from this documentation branch. Do not assume unmerged code is present in main or deployed.

## Security and responsible use

Never commit credentials, bearer tokens, buyer data, or payment secrets. Use synthetic fixtures and redacted evidence in issues and pull requests. Do not publish exploit details or sensitive customer information in public issues; use a maintainer-confirmed private reporting channel. No response-time commitment is established here.

This project is intended for authorized integration, defensive evaluation, and governed workflows. Live financial execution and production delivery activation require explicit review.

## Licensing

The package is marked UNLICENSED. Public repository visibility does not grant an open-source license. Review applicable product terms and obtain permission before redistribution or commercial reuse. This update does not change licensing.
