# codeximmortal-mcp

Public MCP server and agent-discovery surface for [Codex Immortal](https://codeximmortal.com) — governed enterprise agentic AI for operations, security, and revenue.

## Install

```bash
npx -y @codeximmortal/mcp-server
```

## Client configuration (Claude Desktop / Cursor)

```json
{ "mcpServers": { "codeximmortal": { "command": "npx", "args": ["-y", "@codeximmortal/mcp-server"] } } }
```

## Tools

| Tool | Description |
|---|---|
| `codex_catalog_list` | List products/services with pricing basis, capabilities, validation status |
| `codex_catalog_get_product` | Full ERC-8004-shaped service offer |
| `codex_quote_request` | Request a quote (RFQ reference) |
| `codex_attestation_verify` | Verify an attestation record by ID or content hash |
| `codex_scan_request` | Request a threat-hunt scan (defensive, read-only by design) |
| `codex_purchase_initiate` | Prepare a governed purchase proposal (test mode; never executes payment) |

## Governance

All tool calls route through the CI-059 A2A-GATEWAY (genetic ML firewall, wallet metering, immutable audit trail). Payment execution is **disabled**: purchase tools prepare proposals only; live financial consequences require an exact-match, single-use TGA authorization and human approval per the ERC-8004 doctrine.

## Registry status

- CI-059 A2A-GATEWAY: PROVISIONAL
- CI-043 SOVEREIGN-BAZAAR: Active
- This server: UNCERTIFIED (AX-01 / AX-02 / AX-04 pending)
- Payment mode: TEST ONLY

## Links

- Platform: https://codeximmortal.com
- Repository: https://github.com/calebfbyker-lab/codeximmortal-mcp
- License: UNLICENSED (public repo for discovery; not for redistribution)

*The War Lab never reaches final form. Evolution = Sovereignty.*
