# CodexImmortal buyer and agent operator guide

## Customer instruction

Ask your agent to inspect the CodexImmortal catalog, compare the products with your requirements, and return the appropriate one-time checkout link.

## Evaluate before purchasing

1. Read the [product, scope, price and checkout table](../README.md#products-and-hosted-checkout).
2. Match the stated deliverables to your requirements. Ask the merchant to resolve unclear scope, license, delivery timing, support and refund terms before paying.
3. Select the specific one-time product. Starter Kit is $50 USD; Deployment Blueprint is $500 USD. No monthly or annual option is offered here.
4. Open the matching Stripe-hosted checkout. Confirm product, amount, currency and any tax shown before authorizing payment.
5. Retain the receipt and obtain delivery confirmation. Do not treat a receipt as proof of product delivery.

These are hosted checkout links, not a verified autonomous payments API. An agent must not assume spending authority or submit customer payment credentials without authorization.

## Developer and agent operator connection

Remote Streamable HTTP MCP URL:

```text
https://codeximmortal-mcp.onrender.com/mcp
```

Public catalog URL:

```text
https://codeximmortal-mcp.onrender.com/api/v1/catalog.json
```

Connect using your client's supported remote MCP settings. Discover tools through `tools/list`, then call `codex_catalog_list` or `codex_catalog_get_product` through `tools/call`. Interoperability remains unverified; use the README checkout table when catalog responses do not include checkout URLs. Do not use the gateway's private `mcp.tools.call` method as the public MCP wire method.

## Copy for your GitHub profile (draft, not published there)

CodexImmortal products and agent buyer guide: https://github.com/calebfbyker-lab/codeximmortal-mcp/blob/main/docs/buyer-guide.md

## Educational post copy (draft, not posted externally)

Buying software through an AI agent starts with clear scope and transparent pricing, not unrestricted payment access. CodexImmortal now documents eleven one-time product offers with stated deliverables, USD prices and Stripe-hosted checkout links. Ask your agent to compare the offers against your requirements and return the appropriate checkout link. Review scope, licensing and delivery terms before paying. Autonomous payment execution and fulfillment integration are not yet verified.

Buyer guide: https://github.com/calebfbyker-lab/codeximmortal-mcp/blob/main/docs/buyer-guide.md
MCP connection for developers: https://codeximmortal-mcp.onrender.com/mcp

## Status

Documentation publication does not register a server in a directory, configure a client automatically, or authorize spending. Directory acceptance, end-to-end MCP testing and fulfillment verification remain separate checks. The surface is UNCERTIFIED.
