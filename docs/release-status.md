# Release Status and Verification

## Status

The MCP delivery surface is UNCERTIFIED. No production-readiness claim is established by this documentation. Source code, test fixtures, a successful build, and a completed customer delivery are distinct evidence categories.

This documentation branch starts from 2c95ee6df98183d0e58d40a468fd595006aa591d. A separate branch, fix/mcp-buyer-auth-disabled-delivery, received authentication and disabled-dispatch scaffolding at c5dc5e3314d1ea9b7b68aca27d3c44a0c3479a67. That commit was not accompanied by an executed build or test result in the recorded handoff. Its current merge, correction, and deployment state must be checked before use.

## Capability evidence

| Area | Evidence boundary |
| --- | --- |
| Catalog handlers | Implemented in baseline source; external-client verification separate |
| Other advertised MCP tools | Gateway-dependent; operation not certified |
| Prepaid HTTPS adapter | Implemented in baseline source; deployed enablement unknown |
| Buyer-authorized MCP extraction | Not available in baseline; activation blocked |
| Autonomous purchasing | Separate milestone, not authorized by this release |

## Blocking delivery gates

1. Authentication: reject missing, invalid, expired, wrong-issuer and wrong-audience tokens; enforce permissions for each operation. Do not pass MCP tokens through to Base44.
2. Buyer isolation: use ordinary test buyers A and B; prove no cross-buyer balance, job, result, or credential access under concurrency.
3. Deployed delivery: prove the path from a real external MCP client through Render and the authorized backend operation to structured, evidence-grounded results. Document unsupported-page failures.
4. Settlement: prove one debit per successful extraction, replay without a second debit, conflicting-input rejection, same-key concurrency safety, last-credit safety, refunds under published policy, and crash recovery.
5. Failure injection: cover failure before receipt, after reserve, after stored result but before response, and client disconnect.
6. Security: demonstrate secret redaction, SSRF and redirect defenses, bounded input/output, and isolation of untrusted page content from tool behavior.
7. Compatibility and rollback: complete client authentication, test manual invocation while disabled, and preserve entitlements and stored results during rollback.

Passing mocked unit tests does not close deployed or financial-correctness gates.

## Evidence packet

Record each case with:

- Commit and, if relevant, working-tree digest.
- Environment and actual execution timestamp.
- Case identifier and fixture/account category.
- Expected and observed behavior.
- Redacted evidence and correlation identifiers.
- PASS, FAIL, or INCONCLUSIVE.

Keep synthetic fixtures, test accounts, internal purchases, and customer activity separate. Never include tokens, keys, payment credentials, or customer results in public evidence.

## Engineering follow-up

- Run the authentication branch's build and tests and correct all failures before merge.
- Resolve and review dependency versions and the lockfile.
- Ensure CI actually triggers on the implementation branch or its pull request. The inspected baseline worker workflow only lists selected branch names.
- Establish the real issuer, token profile, permissions, and trusted buyer-to-backend mapping.
- Implement and test the buyer-session adapter and output projection.
- Review gateway defaults, response-status validation, input validation, and error handling.
- Verify actual SDK protocol negotiation rather than relying on a manifest version string.
- Verify Render configuration without disclosing secret values.

## Activation policy

Keep MCP delivery default-off until the release gates pass and explicit HUMAN GATE approval is recorded. Auth configuration, merging code, deployment, and delivery activation are separate changes and require their own review. Do not advertise extraction as operational before activation is verified.

New delivery work remains UNCERTIFIED until the required AX-01, AX-02, and AX-04 checks have supporting evidence. This document assigns no CI identifier and changes no canonical registry status or doctrine.
