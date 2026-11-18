# Buyer and job authority integration

Status: NEW CLIENT CONTRACT; not a deployed Base44 function or completed commerce backend.
This patch supplies the MCP-side concrete HTTP client and disabled-by-default runtime.
It does not implement a financial ledger or claim remote atomicity.

## Findings
Existing Base44 webToJson.ts uses separate balance update, job creation and ledger writes.
web_to_json_extract checks for prior idempotency records before separate admission.
That source does not establish a transaction spanning reservation/job/outbox or a unique
concurrent request claim. Do not generalize it into the three new paid services unchanged.

## Wire protocol (proposed server contract, not an existing endpoint)
Operator explicitly provisions AGENT_COMMERCE_AUTHORITY_URL on the approved Base44
origin, under /functions/<reviewed-name>. No URL default or invented live function.
POST application/json, separate Authorization:Bearer service credential, redirects forbidden.
Request: {version:"agent-commerce-authority-v1",operation,payload}.
Success: {version:"agent-commerce-authority-v1",data:...}.
Error: {version:"agent-commerce-authority-v1",error:{code,retryAfter?}} with HTTP error status.
No agent bearer token is forwarded. Responses bounded to 1 MiB and a 10s fetch deadline.
No automatic retries, especially after submit timeout. Reuse original idempotency key.
Service credential must be authenticated at authority; function cannot be public-write.

resolve_buyer payload: {issuer,subject,clientId}; returned data adds active:true,
canonical UUID buyerId and allowed scopes, and echoes issuer/subject/clientId.
Bindings must be provisioned from verified enrollment, not caller email or UUID claims.
Returned scopes intersect access-token scopes; no scope escalation. Issuer config must
match the introspector. Resolution happens on every authenticated request.

quote payload: {buyerId,clientId,service,input,inputDigest}; digest is SHA256 of canonical
{service,input}, using api.ts canonicalization. Server validates service/input independently.
Return {buyerId,clientId,id,service,inputDigest,amountMinor,currency,expiresAt}.
Backend persists and binds quote to buyer/client, delegation, terms/version and price.
No client amounts/currency; client validates safe integer amount, uppercase currency,
owner/client/service/input and unexpired expiry. Canonical quote/delegation authority is backend.

submit payload: {buyerId,clientId,service,input,quoteId,idempotencyKey,digest}.
Digest covers canonical {service,input,quoteId}. Server recomputes rather than trusting it.
Return {buyerId,clientId,id,status,service,requestDigest}; status queued/running/succeeded/failed.
Identical replay can return completed job. Client validates ownership and request digest.

job payload: {buyerId,clientId,id}; return {buyerId,clientId,id,status}.
result payload: {buyerId,clientId,id}; return {buyerId,clientId,jobId,status:"succeeded",
service,value,receiptId}. Missing, pending or inaccessible results return 404/not_found;
use job status to distinguish pending from failed. No arbitrary download URL passthrough.
Current policy is client-bound access within buyer; broader delegation needs explicit backend policy.

## Authoritative backend requirements (blocking, not implemented by this patch)
One durable atomic admission must check account/client/delegation, quote and expiry,
claim unique buyer+operation+idempotency key, enforce same-key digest consistency,
reserve funded entitlement, enforce running/admitted concurrency policy, persist job and outbox.
Atomic replay returns original job; conflicting digest returns 409/idempotency_conflict.
No check-then-create race, read-modify-write balance accounting or client-owned ledger.
Recovery leases, result persistence, receipt creation and reservation finalization/release
must be durable and deduplicated. Crash after any write must not duplicate debit or strand funds.
Verify Base44-supported transaction/CAS/unique constraints before implementation. If platform
cannot meet required semantics, seek owner architecture approval; do not silently move authority.

## Runtime integration
http.ts mounts /api/v1/agent before global JSON parsing; default returns service_disabled.
Enable ONLY after real backend provisioned, policy reviewed and integration tests pass:
AGENT_COMMERCE_ENABLED=true
AGENT_COMMERCE_AUTHORITY_CONTRACT=agent-commerce-authority-v1-reviewed
AGENT_COMMERCE_AUTHORITY_URL=<reviewed Base44 function URL>
AGENT_COMMERCE_SERVICE_TOKEN=<separate service secret>
AGENT_AUTH_ISSUER=<trusted OAuth issuer>
AGENT_AUTH_INTROSPECTION_URL=<trusted HTTPS endpoint>
AGENT_AUTH_CLIENT_ID=<resource server introspection client>
AGENT_AUTH_CLIENT_SECRET=<resource server introspection secret>
AGENT_AUTH_AUDIENCE=<this MCP resource audience>
AGENT_RATE_LIMIT_DATABASE_URL=<security-metadata PostgreSQL connection>
Flags are deployment configuration, NOT proof of backend certification or atomicity.
Rate-limit schema/privileges must be provisioned separately. No migration at startup.
No payment activation, price changes or tool publication in this patch.
MCP wire dispatch remains separate work: do not advertise the three tools as live yet.

## Verification
npm run build
npm test -- src/agent-commerce/base44-authority.test.ts
npm test
No compilation/tests performed by the authoring environment for this patch.
Mocks establish client behavior only. Mandatory real-adapter tests: two buyers/clients,
subject mapping/revocation, changed quote, concurrent duplicates/conflicts, funds exhaustion,
response mismatch/timeout/oversize, crash recovery, finalization replay and no raw-token forwarding.
Test HTTP route mounting, disabled-mode behavior and server startup integration separately.
