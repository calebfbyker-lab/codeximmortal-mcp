# Injectable HTTP app and transport integration — proposed patch

Base: d9eb716424b84551d6f21383f96125ad28cb69ea
Branch: feat/agent-native-commerce-api
Status: PREPARED, NOT BUILT OR TESTED IN THE AUTHORING ENVIRONMENT.
No repository commit or deployment performed by creating this package.

## Boundary

createHttpApp in src/http-app.ts accepts tool definitions, catalog, agent-card
JSON, commerce dependencies, fallback dispatcher, storefront middleware and
pricing route/middleware. Importing it does not inspect environment variables,
create a pool, instantiate payment providers or open a listener. http.ts retains
production environment composition, x402 opt-in checks and listen(). The factory
still uses the existing MCP server, request-scoped dispatcher and agent API router.

Production loadTools() remains unchanged. The HTTP tests inject commerce tool
fixtures; they are not publication or price approval. No manifest, registry,
funding, payment, wallet, worker, migration, package or lockfile changes.

Middleware order remains storefront-owned parser, agent API-owned parser,
pricing-specific 8kb parser, global parser, public/MCP routes, pricing middleware,
redacted error handler. GET /mcp now explicitly returns 405 with Allow: POST,
indicating stateless operation without a resumable server event stream.
Unexpected transport and parser errors use fixed log event names rather than
arbitrary exception names. The response-close handler closes both SDK objects;
errors after headers are sent do not attempt a second response.

/healthz remains liveness only, NOT database/provider/worker/payment readiness.
Router injection is a trusted composition interface, never a request parameter.

## Supplied HTTP tests

Real loopback listeners use 127.0.0.1 and ephemeral ports. SDK HTTP client tests
cover initialization, listing and public tool calls. node:http raw-header tests
exercise missing/malformed/invalid/duplicate/oversized credentials; disabled
commerce; scopes; simultaneous buyers; stable and distinct submission keys;
backend conflicts; internal-error redaction; production publication barriers;
agent API parsing; fixture storefront-owned parsing; public catalog/card/health;
disabled pricing; pricing limits/order; malformed MCP JSON. Listeners and sockets
are closed in afterEach. Fixtures use no production credentials or real payments.

Backend and storefront fixtures are mocks. These tests do not establish real
OAuth issuer behavior, token introspection, resource ownership, database replay,
funding, settlement, real storefront fulfillment, provider delivery, process-kill
recovery, HTTP batch support, or deployed behavior. Batch behavior is not changed
or promised; it depends on the installed MCP SDK. Test SDK compatibility by running
the build and suite; no passing result is claimed here.

## Review and verification

Do not overwrite unrelated work. Preserve the nested checkout package-lock.json.
Do not use the previous patch runner: it targets the earlier dispatch patch.
These files are a proposed next commit and must be approved before GitHub writes.

PowerShell, after the reviewed commit is applied and its HEAD verified:

npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
npm.cmd test -- src/http-app.integration.test.ts src/agent-commerce/mcp-dispatch.test.ts src/server-redaction.test.ts
if ($LASTEXITCODE -ne 0) { throw 'HTTP/dispatch/redaction tests failed' }

Then run the full suite using the approved disposable PostgreSQL procedure with
TEST_DATABASE_URL, CODEX_DB_TEST_ACK=disposable-database-only and REQUIRE_DB_TESTS=true.
Do not substitute skipped DB tests for a pass. No npm install or staging commands
are included. Existing PostgreSQL CI executes npm test and should pick up the
new integration file; inspect actual run evidence rather than assuming success.
