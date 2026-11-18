# Agent-native service implementation

Status: review-only; not mounted, deployed, priced, compiled or tested by authoring environment.
Base: feat/agent-service-contracts at 601a04525e155d1c9c2f40b16acfef41fb45aa6c.
This commit is an integration foundation, not a completed payment-to-delivery system.

## Endpoints
Mount createAgentCommerceRouter(dependencies) under /api/v1/agent BEFORE the global
JSON parser. Keep enabled:false until adapters, authentication and tests are ready.
POST /quotes {service,input} ->200 server-owned quote.
POST /jobs {service,input,quoteId} + Idempotency-Key ->202 durable job.
GET /jobs/:id ->200 status or 404 missing/foreign.
GET /jobs/:id/result ->200 result or 404 when no retrievable result exists.
Use job status to distinguish pending result from failure.
Success: {data,requestId}. Error: {error:{code,retryable},requestId}.
JSON only for POST; 32 KiB maximum; compressed input rejected; Cache-Control:no-store.

Inputs:
pricing_snapshot: {sourceId} refers to buyer-accessible approved source, not arbitrary URL.
pricing_compare: {beforeId,afterId}, both owned by authenticated buyer.
document_extract: {documentId,profile:"scalar-fields-v1",fields:["total"]}.
Document provider must enforce supported formats, byte limits, 20 pages, 100 fields,
malware screening and evidence provenance. Existing validators are lexical, not proof
of source truth. Trust/completeness is backend metadata, never caller assertions.

## Agent authentication
Provision OAuth clients and bind issuer sub to a canonical Base44 buyer. Obtain
access tokens from the configured authorization server and send Authorization:Bearer
on every protected call. Client credentials may represent explicitly provisioned machine
buyers, not arbitrary delegated human buyers. Delegation requires separate approval.
createIntrospector validates active, issuer, audience, expiration, optional nbf, bearer
type, client ID, subject and scope. HTTPS only, no redirects, 5s timeout, 16 KiB response.
No token cache: revocation applies next call. Secrets are server configuration only.
Required scopes: commerce:quote, services:execute, jobs:read, results:read.
Use separate backend credentials; never pass the agent bearer through to Base44.
OAuth protected-resource discovery/metadata and authorization-server configuration are
NOT implemented. Do not claim general MCP OAuth interoperability before those exist.

## Rate limits
postgresLimiter(pool) provides atomic DB-backed minute-window limits, shared across
replicas: quote 30, submit 10, job 120, result 120. Each operation is limited per buyer
across clients AND per client across buyers. Fixed windows allow boundary bursts.
Apply sql/agent-commerce-rate-limits.sql under a migration role, use a non-owner
runtime role, bounded pool and connectionTimeoutMillis:2000. Statement timeout 2s,
lock timeout 1s. Fail closed on outage; return 429 plus Retry-After on exhausted quota.
Configure privileged cleanup of old rows separately. No database changes occur on import.
Max two running jobs per buyer must be enforced by authoritative admission (not limiter).
Ingress must enforce unauthenticated IP/connection/body limits, trusted proxy settings
and slow-request timeouts. JSON parsing occurs before application authentication.

## Base44 integration and durable money handling
Dependencies.backend is a PORT, not an implemented Base44 client. No backend endpoint
or schema is invented here. Implement against the verified authoritative contract.
quote() binds buyer, client/delegation, service, input digest, amountMinor, currency,
terms/version, expiry and maximum spend. Clients never choose prices or currency.
submit() must atomically check ownership/quote/expiry/delegation, reserve prepaid units,
persist job, idempotency record and outbox. Scope uniqueness by buyer+operation+key.
Persist digest: same key/payload returns original job; changed payload returns 409.
Proposed retention >=24h. Do not emulate atomicity with independent HTTP calls.
Worker uses a durable lease, executeService(), result/receipt persistence and exactly-once
reservation finalization. Recovery must reconcile failed/expired leases without double debit.
job/result lookup always includes buyer; missing and foreign resources both return null.
Foreign-resource isolation is an ADAPTER obligation; mocked unit tests do not prove it.

## Three service execution pathways
worker.ts reuses validateSnapshot, compareSnapshots and validateDocument from the existing
service-contract branch. Providers supply real capture, snapshot retrieval and extraction.
No arbitrary web fetcher, document intake/PDF/OCR parser or live extraction model is included.
Comparison preserves trusted completeness rules and buyer-scoped stored snapshots.
Document output must contain exactly the requested field names; evidence still needs
real provenance verification. Never treat submitted assertions as extracted source facts.

## MCP integration
invokeMcp maps codex_service_quote, the three service names, codex_job_get and
codex_result_get to shared authorization/admission. It is NOT mounted in /mcp yet.
Service tool args: {input,quoteId}; quote args: {service,input}; reads: {id}.
Pass Idempotency-Key through a documented transport metadata field, never a shared global.
Capture bearer from each authenticated HTTP request, not tool args. Preserve request-scoped
identity through dispatchTool. Convert ApiError to sanitized MCP tool isError output;
HTTP transport authentication still uses HTTP 401/403. Add input schemas/manifests only
after transport auth and adapters work. Stdio requires explicit local credential provisioning.
Do not inherit the shared gateway token as a buyer identity.

## Errors and retries
400 invalid request; 401 token; 403 scope/delegation; 402 payment_required;
404 missing/foreign; 409 idempotency conflict; 413 oversized; 415 media type;
429 quota; 502 invalid provider output; 503 disabled/dependency outage.
Backend expected failures use ApiError with fixed, reviewed codes, never exception strings.
Unknown HTTP errors become 503 dependency_unavailable. No bodies, credentials, payment
secrets, documents or backend exception messages in logs. Request IDs are server-generated.
Retry 429 respecting Retry-After; 503 with bounded exponential backoff and jitter.
Submission retries reuse the SAME key/payload. A timeout is not proof admission failed.
Do not mint another key to retry an uncertain charge. Resolve other errors before retrying.

## Purchasing and fulfillment status
Agent execution against explicit prepaid entitlements need not visit codeximmortal.com.
The entitlement adapter and payment initiation/confirmation pathway are not implemented.
Insufficient funds ->402; no automatic top-up without enforceable explicit delegation.
This commit changes no prices, checkout links, enabled flags, payment mode or live payout.
Not included: payment adapter, authoritative job queue/outbox worker, settlement, source
providers, identity provisioning, discovery metadata, release wiring or production activation.

## Verification required
npm run build
npm test -- src/agent-commerce/api.test.ts
npm run test:db (existing disposable-database safeguards apply)
Added tests are mocked boundary tests and have not been executed. Also require real
HTTP/MCP transport tests, introspection failure/bounds cases, worker/provider tests,
two-buyer adapter isolation, concurrent idempotency replay/conflict, multi-replica limiter
and boundary tests, crash/recovery/reservation reconciliation, and payment-to-delivery tests.
No CI identifier or certification is allocated by this commercial implementation.
