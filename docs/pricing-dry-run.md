# Local pricing-worker dry run (draft)

No public route, payment handler, ledger, or listener is added. This does not
modify the production contract or enable x402. The adapter is not yet a
verified Base44 contract or a runtime validator. Status: UNCERTIFIED.

## Test and build

```sh
npm test -- src/pricing-worker.test.ts src/pricing-contract.test.ts
npm run build
```

## PowerShell: reviewed live page

Review destination, content, terms, and permissions first. Set the allowlist
independently of the requested URL. The CLI flag expresses operator intent;
it does not prove review. Never derive approval from request input.

```powershell
$env:PRICING_APPROVED_URLS = '["https://REPLACE-WITH-REVIEWED-HOST/pricing"]'
node dist/pricing-dry-run-cli.js --reviewed-url 'https://REPLACE-WITH-REVIEWED-HOST/pricing'
```

The placeholder is not a supported-page claim. Use a reviewed canonical
URL containing supported JSON-LD offers. The command makes an outbound
HTTPS request with ordinary compute/network costs, but invokes no payment
or credit mechanism. Existing exact-URL, DNS/IP, TLS, redirect, byte, and
time restrictions remain in the worker. No Render configuration changes.

Success emits the draft result to stdout. Failure exits nonzero with a
sanitized error. Review output before sharing: source URLs and evidence
may be sensitive. Prices remain decimal strings; unknown pricing terms
remain null. Evidence preserves the worker excerpt, whose outer whitespace
is already trimmed. Job identity and settlement are outside this contract.

Tests use the real parser on local fixtures and real allowlist preflight
checks without network access. The closed runtime-import graph test keeps
billing/server modules out of the CLI dependency tree. It is a regression
guard, not a general proof against arbitrary future JavaScript. The billing
output marker alone is not proof of zero charges. These tests do not verify
live DNS/TLS/fetch behavior, payment reconciliation, or existing HTTP routes.
Run and record a reviewed real-page dry run separately before release.
