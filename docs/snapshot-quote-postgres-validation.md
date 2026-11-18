# Real PostgreSQL snapshot quote validation

Status: proposed/unexecuted test increment, UNCERTIFIED. No production code, migrations, prices, publication guards or runtime flags are modified.

The test uses the real MCP SDK, loopback HTTP app, request-scoped dispatcher, shared admission validation, PostgresCommerce.resolve and PostgresCommerce.quote. Authentication maps two synthetic bearer strings to test subjects; OAuth introspection is not exercised. Quota consumption is synthetic. Sources are real rows in the owned-resource admission index; no website/provider is fetched.

Use a separately provisioned disposable local PostgreSQL database named codex_quote_test. TEST_DATABASE_URL must use postgres/postgresql, localhost/127.0.0.1/IPv6 loopback, that exact database name and no query/hash. Database access credentials stay local; never commit or paste them. The suite creates a random quote_mcp_test_* schema, migrates only into it, truncates its own tables between tests, and drops it after tests. It does not create/drop the database. URL checks and acknowledgment cannot establish that a local port is not forwarding to production: the operator must verify the target is disposable. A process crash can leave the randomly named schema for manual inspection/cleanup.

PowerShell, after configuring TEST_DATABASE_URL to that disposable database:

```powershell
$env:REQUIRE_DB_TESTS = 'true'
$env:CODEX_DB_TEST_ACK = 'disposable-database-only'
try {
  npm run build
  if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
  npx vitest run src/agent-commerce/snapshot-quote-postgres.integration.test.ts
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL MCP quote validation failed' }
} finally {
  Remove-Item Env:REQUIRE_DB_TESTS -ErrorAction SilentlyContinue
  Remove-Item Env:CODEX_DB_TEST_ACK -ErrorAction SilentlyContinue
}
```

Without TEST_DATABASE_URL ordinary test runs skip this suite; REQUIRE_DB_TESTS=true instead fails collection if missing. Never count a skipped suite as validation. The build/test commands have not been run by the assistant.

Eight test cases cover persisted identity/input/digest/price-version/amount/currency, returned expiry equal to storage with a five-minute database-clock bound, concurrent same-source-ID buyer isolation, foreign/missing/not-ready source rejection, changing configured price while retaining old quote values, missing/disabled/currency-mismatched prices and caller identity/amount/currency injection. After every test the suite compares all wallet rows, all ledger rows, delegation reserved/spent values and jobs/reservations/outbox/results counts to their pre-call baselines. Synthetic wallets and funding ledger entries are fixture data, not a funding API. Amounts 250 and 375 are test fixtures, not commercial prices.

Persisted expiry is tested here; admission rejection of an expired quote remains covered by the existing postgres-commerce.integration.test.ts suite. Actual OAuth, PostgreSQL quota enforcement, provider source ownership/content, charging/settlement, production deployment and profit are not proven by this suite. Run existing database and HTTP regressions separately before release review.
