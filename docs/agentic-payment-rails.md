# Agentic payment rails

Decision record and evolution contract for how this repository collects money
from agents. Extends `commercial-scope-boundary.md`; it does not replace it.
Facts below cite the repository at a specific commit and are labeled by status.
Claims of operational capability are forbidden unless the status says otherwise.

## Decision (2026-11-18)

codeximmortal.com serves humans and collects fiat through Stripe. This repository
serves agents and collects agentic payments only. There is no Stripe integration
in this repository, and none is planned here; a Stripe webhook route in this repo
would be scope drift. If a human later funds an agent wallet with a card, that
flow is owned by codeximmortal.com, which may credit wallets server-to-server
under its own separate approval. Money verification belongs to the rail that
received the money; accounting belongs to this repository's wallet ledger.

Agentic payments travel on two rails:

1. Direct per-request payment: x402, USDC on Base, collected straight to the
   operator's `X402_PAY_TO` address per request. Anonymous agents, no accounts.
2. Wallet funding: authenticated agents top up a PostgreSQL wallet with an
   on-chain USDC deposit, then spend through the commerce API with scopes,
   budgets, reservations, receipts and settlement.

## Verified state

| Component | Status | Evidence at commit `030e1fd` |
|---|---|---|
| x402 direct rail | Testnet scaffold, operator-gated for mainnet | `src/x402-routes.ts`; mainnet requires `X402_MAINNET_APPROVED=true`, funded `X402_PAY_TO`, reviewed `PRICING_APPROVED_URLS`; code notes absence of order recovery |
| Commerce API (quotes, jobs, results) | Implemented, integration-tested; disabled by default | `src/agent-commerce/`, `AGENT_COMMERCE_ENABLED` gate |
| Durable worker composition | Committed `67798b1`, CI verdict pending at time of writing | `src/agent-commerce/commerce-worker.ts` |
| Funding core (orders, event inbox, atomic credit) | Committed `a99912a`, import fix `030e1fd`, CI verdict pending at time of writing | `postgres-funding.ts`, `standalone_commerce_funding_v1.sql`; provider set is `stripe | crypto`, crypto path is first-class |
| Crypto deposit adapter | Not implemented | — |
| Agent-facing funding API | Not implemented | — |
| Prices for any service | Not set; all services remain unpriced | — |
| Deployment of commerce or worker | Not performed | — |

The funding core is rail-agnostic by design: adapters verify money arrival and
call `credit()`; buyer identity always comes from the persisted funding order,
never from event metadata. The crypto deposit adapter requires zero changes to
the settlement core.

## Build order

1. Agent-facing funding API: authenticated, scope-gated order creation returning
deposit instructions (amount, receiving address, payment reference, expiry).
2. Crypto deposit adapter: watch-only deposit-address detection, confirmation
   policy for reorg safety on Base, feeding verified transfers into
   `PostgresFunding.credit` with the transaction hash as `provider_ref`.
3. x402 mainnet go-live decision: operator gate, plus a decision on whether to
   add post-payment order recovery before going live.
4. Optional, later, owner decision: codeximmortal.com credits agent wallets
   server-to-server after Stripe collection on the website.

## Owner gates

No rail goes live without explicit owner approval of all of: real delivery
verified, funding verified, prices set, deployment performed. Enabling commerce,
flipping `X402_MAINNET_APPROVED`, setting prices, and publishing to registries
are each irreversible public-facing decisions and each requires separate human
approval. Nothing in this file authorizes activation.

## Evolution rules

1. No payment adapter in this repository touches Stripe. Stripe belongs to
codeximmortal.com.
2. Verification and accounting stay separated: rails verify money arrival; the
wallet ledger is the only writer of wallet balances; every credit flows through
`PostgresFunding.credit` or an owner-approved successor with equivalent atomicity.
3. Private keys and spending custody never enter this repository. Deposit
addresses are watch-only; receiving-address custody lives in the operator's
separate wallet infrastructure.
4. One payment settles one credit, at every level: provider event id, payment
reference, and ledger external reference are each uniquely constrained.
5. Buyer identity for a credit comes from the persisted funding order binding,
never from webhook, event, or request metadata.
6. Lock order is buyer-first everywhere: admission, worker settlement, and
funding settlement must not invert lock acquisition order.
7. Status labels are mandatory in docs and claims: implemented, scaffold,
committed-unverified, or not-implemented. Never present a committed-but-unverified
component as operational.
8. Every commit in this area updates this file's Verified state table or is
flagged as leaving it stale.
