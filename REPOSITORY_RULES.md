# CodexImmortal MCP Repository Rules and War Lab Boundary

Owner: Caleb Byker
Repository: calebfbyker-lab/codeximmortal-mcp
Scope: repository engineering, agent interfaces, commercial services and operations.
This is repository guidance, not a War Lab doctrine amendment or production authorization.

## 1. Two distinct scopes

### War Lab
The CodexImmortal Agentic War Lab has its own mission, doctrine, canonical CI
registry, AX governance, sovereign-layer architecture and defense-specific gates.
Its ledgers and doctrine remain authoritative for work actually in that scope.
This document does not rename modules, change CI status, amend doctrine or waive
War Lab controls for a real War Lab integration.

### MCP repository
This repository contains agent discovery, an existing storefront catalog surface,
and a developing standalone agent-commerce implementation. Repository engineering
is evaluated against its code, contracts, tests, security and operating requirements.
Shared branding does not make every commercial feature a War Lab module.

## 2. What does not automatically carry into commercial repository work

Unless an explicitly scoped War Lab integration requires it:
- Do not assign CI numbers to commercial products, patches or ordinary engineering tasks.
- Do not require AX registry sync or War Lab certification merely to implement a
  commercial endpoint, funding order, pricing rule, migration or test.
- Do not describe ordinary commercial outputs as NFT-attested, post-quantum secured,
  BFT-governed, defense-certified or government-authorized without specific evidence.
- Do not use Shield Score, Vault Shards, Neural Peers or Attested NFTs as substitutes
  for commercial reliability, security, cost or accounting measurements.
- OODA is optional for repository documentation and engineering responses; it is not
  a repository acceptance criterion or a substitute for an implementation.

Actual War Lab integrations must identify the applicable module, authority, data
boundary and approvals. A commercial label cannot be used to evade those controls.

## 3. Existing catalog versus standalone services

### Existing storefront catalog
catalog.json and its matching buyer documentation govern existing catalog offers.
Preserve their stated scope, prices, checkout links and existing fulfillment paths
unless a separately reviewed change explicitly updates them.
Do not reinterpret an existing storefront payment as standalone MCP wallet funding.

### New standalone MCP services
The standalone scope consists of pricing_snapshot, pricing_compare and
 document_extract. The approved architecture uses the deployed MCP/API service,
its own PostgreSQL commerce authority and direct Stripe integration.
These services must not depend on Base44 or a codeximmortal.com visit for their
commerce or execution path. Buyer authorization may still use Stripe-hosted UI.
This is an architectural target, not a claim that all components are implemented.

No existing Base44 buyers, balances, entitlements or jobs are migrated or shared
without explicit owner approval and a separately verified migration plan.
Retained Base44 adapters, old specifications and existing storefront integrations
are not the authority for these three services.

## 4. Repository evidence and decision authority

Use evidence appropriate to the question:
- Current code and migrations establish implemented behavior and constraints.
- Executed tests establish only the behavior, commit and environment actually tested.
- Approved product terms and configured server-side prices establish commercial terms.
- Verified deployment configuration and operational checks establish runtime state.
- Roadmaps, examples and proposed schemas are not implemented capabilities.

Never fabricate commits, deployments, CI outcomes, customer demand, revenue,
certification or pricing approvals. Code existence does not prove deployment.
A historical note saying untested and a later passing run must be distinguished,
not silently treated as identical evidence.

Report commit, environment, command, expected result, observed result, redacted
evidence and limitations for consequential verification claims. A skipped required
database suite is not a database pass. Local success is not remote CI success.
Do not change runtime certification/publication guards through documentation alone.

## 5. Commercial security and payment rules

- Authenticate buyers and agent clients; enforce scopes, ownership, delegation,
  spending caps and concurrency limits server-side.
- Keep buyer-authorized funding separate from permission to execute services.
- No automatic top-ups, autonomous charging or unlimited spending by implication.
- Resolve amounts and currency server-side. Synthetic test prices are not launch prices.
- Verify Stripe webhook signatures against raw request bytes and verify payment
  state/account/environment/amount/currency before any wallet grant.
- Make admission, funding grants and settlement transactional and idempotent.
- Preserve durable ledger and receipt history; refunds/disputes use reviewed adjustments.
- Do not accept payment redirects, tool arguments or model assertions as proof of payment.
- Keep secrets, card data, payment client secrets and bearer tokens out of source,
  logs, prompts, documentation and test evidence. Use secret configuration and redaction.
- Bound provider execution, input sizes, retries, retention and external costs.
- Lease fencing protects database settlement, not exactly-once external side effects.

## 6. Release controls

Architecture selection is not approval for a specific external write or deployment.
Obtain required exact-action approval before repository/service writes performed by
an assistant, and explicit owner approval before production enablement, live
payment activation, price publication, material commercial terms changes or balance migration.

Keep new services disabled and unpublished until funding, real providers,
authenticated MCP dispatch, receipts, recovery and operations pass applicable checks.
Required release evidence includes real PostgreSQL tests, payment-event tests,
provider integration, buyer isolation, crash/retry exercises and a deployed
quote-to-job-to-result-to-receipt path. Track gaps specifically; do not substitute
War Lab terminology for these checks.

## 7. Working style and change safety

Use direct engineering language, concrete artifacts and verified next steps.
Separate implemented, locally tested, CI-verified, deployed and proposed states.
Use UNCERTIFIED only with the specific missing evidence; do not imply AX involvement
in a commercial release unless that involvement was actually scoped.
Preserve untracked files, especially package-lock.json in the owner's working copy.
Do not reset, delete, auto-stage or overwrite unrelated work. Use reviewed migrations
and least-privilege runtime roles; never drop real financial schemas to retry setup.

## 8. Scope conflicts and assistant instructions

For ambiguous work, identify whether it affects the storefront, standalone commerce,
War Lab, or an explicit integration before changing authority or financial state.
This file guides repository work. It cannot override system/developer instructions,
security policy, connector confirmations or instructions enforced by the hosting
assistant workspace. A workspace still configured for War Lab behavior must be
updated separately by its owner; committing this Markdown does not change it.

AGENTS.md is the entry point for agent readers and should link to this boundary.
No price, live flag, deployment, registry entry or government endorsement is created
by adopting this document.
