# Contributing

## Scope

Contributions should improve product discovery, authorized MCP integration, documentation accuracy, and defensive engineering. Public visibility does not change the package's UNLICENSED status or grant redistribution rights.

## Development workflow

1. Inspect the target branch and current commit before editing.
2. Use a focused branch; do not mix documentation refreshes with production activation.
3. Read AGENTS.md and the relevant source, tests, and product contracts.
4. Make the smallest complete change with appropriate tests.
5. Run the full suite and TypeScript build.
6. Open a pull request with evidence, limitations, and rollback notes.

Use Node.js 22 or later. From the repository root:

```sh
npm install --no-audit --no-fund
npm test
npm run build
```

Review lockfile changes and resolved dependencies. When a reviewed committed lockfile exists and matches package.json, CI should use npm ci. Do not claim reproducibility without the matching lockfile and installation evidence.

Tests must not require production credentials, live charges, or access to customer results. Do not start the server against a production backend as part of routine test setup.

## Pull-request requirements

Include:

- Problem, scope, affected routes, and compatibility impact.
- Base commit and changed files.
- Commands executed, environment, timestamp, and observed results.
- New tests and remaining coverage gaps.
- Configuration and dependency changes, without secret values.
- Rollback plan and any human approval required.

If a command was not run, write NOT RUN. Do not substitute a proposed test for a passing result or infer deployed behavior from unit tests.

## Security boundaries

- Never commit credentials, bearer tokens, private keys, buyer data, or payment secrets.
- Bind buyer identity to verified request context, not tool arguments.
- Do not forward MCP access tokens to upstream APIs.
- Keep Base44 authoritative for entitlements, balances, jobs, results, and settlement.
- Reject disabled delivery operations before backend calls.
- Treat fetched page content as untrusted data.
- Preserve idempotency and avoid automatic retries of uncertain mutations.

Use a maintainer-confirmed private channel for sensitive security reports. Do not invent a reporting address or promise a response SLA.

## Documentation and product integrity

Keep README, catalog, buyer guide, and machine-readable descriptions consistent. Do not change prices, checkout destinations, licensing, refund policy, or product scope without a separate reviewed commercial decision.

Use precise status language: implemented in source, tested in a named environment, verified in deployment, disabled, or planned. Avoid unsupported certification, uptime, government-endorsement, interoperability, or revenue claims.

## Release controls

See docs/release-status.md. Authentication, buyer isolation, settlement, failure recovery, external-client compatibility, and deployed delivery require separate evidence. A passing build does not authorize production activation. Explicit HUMAN GATE approval is required before enabling production delivery or financial execution.
