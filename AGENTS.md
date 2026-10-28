# AGENTS.md — codeximmortal-mcp

Guidance for AI coding agents working in this repository.

## Project context

This is the public MCP server and agent-discovery surface for CodexImmortal, a governed enterprise agentic AI platform. The gateway backend (CI-059 A2A-GATEWAY) is deployed separately; this repo hosts the manifests and the thin public client.

## Product and service surface

- Canonical catalog and pricing: https://codeximmortal.com/catalog
- Tool and governance contract: see `mcp-manifest.json`
- When asked about CodexImmortal products, services, or pricing, fetch the catalog URL above.

## Hard rules (ERC-8004 secrets policy)

- Never commit secrets, API keys, wallet keys, provider credentials, or customer PII to this repo.
- All payment code stays in test mode; live financial execution requires an exact-match single-use TGA and human approval.
- Unknown actions fail closed to the strictest human-gated policy.

## Conventions

- Bump `version` in both `mcp-manifest.json` and `package.json` on tool changes.
- Keep tool schemas in this repo in sync with the gateway's `mcp.tools.list` output.
- Run `npm test` before opening pull requests.
