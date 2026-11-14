# Safe-fetch hardening (P0 network gate)

Status: implemented and covered by a dedicated no-database vitest suite; NOT
executed. No build, test run, migration or deployment has been performed for
this change. The Stage 8 suites on this branch also remain unexecuted.

## What changed (src/agent-services/safe-fetch.ts)

- Byte-exact IPv6 parsing (parseIPv6Bytes): zone-id stripping, compressed "::"
  and embedded IPv4 notation, character-by-character group parsing with no
  regexes, and v4-tail byte splicing. This closes the mapped-address bypass
  where 0:0:0:0:0:ffff:7f00:1 classified as public under the previous
  string-prefix checks.
- Fail-closed destination policy (isPublicAddress): IPv4-mapped,
  IPv4-compatible, NAT64 (64:ff9b::/96) and 6to4 (2002::/16) forms reduce to
  their embedded IPv4 payload and are classified by it; loopback, unspecified,
  Teredo (2001::/32), discard-only (100::/64), documentation (2001:db8::/32),
  ULA (fc00::/7), link-local (fe80::/10), deprecated site-local (fec0::/10)
  and multicast (ff00::/8) always block. Anything unparseable is private.
- Bounded DNS: resolution races a configurable timeout (dnsTimeoutMs, default
  5000 ms) and rejects answers above maxDnsRecords (default 32); every returned
  address across all families is validated before connecting, and the
  connection stays pinned to the validated IP with SNI preserved.
- Stream disposal: response bodies are destroyed on redirect, abort, oversize
  and read failure.
- TLS: TLSv1.2 floor, certificate verification (rejectUnauthorized) and ALPN
  http/1.1 on the outbound connection.
- URL validation: port must be 1-65535; bracketed IPv6 literals are
  policy-checked directly without DNS.
- Backward compatible: all prior exports preserved; new constructor options
  are optional with validated defaults.

## P0 acceptance mapping

| Criterion | Coverage |
|---|---|
| Normalized IPv6 | parseIPv6Bytes expansion tests plus policy cases for mapped, compatible, NAT64, 6to4 and zone-id spellings |
| Bounded DNS | dnsTimeoutMs and maxDnsRecords with all-record validation tests |
| Stream disposal | dispose-on-redirect, oversize, error and mid-read abort tests |
| Destination policy | IPv4 and IPv6 classification tables; fail-closed malformed cases |
| TLS | TLSv1.2 floor, rejectUnauthorized, ALPN set at the connect layer (configuration-level) |
| Cancellation | pre-abort, mid-read abort and timeout tests |

## Honest limits

- No live network or TLS handshake test: connect is stubbed in the suite.
  Certificate behavior is enforced by configuration only and must be exercised
  by the guarded local procedure and any later staging run.
- This closes P0 item 4 (fetch hardening) at the code level. Items 1-3 and 5-8
  (snapshot evidence, snapshot identity, comparison trust, ownership bridge,
  document extraction, commerce integrity, release evidence) remain open.
- Unexecuted: run npm.cmd exec -- vitest run
  src/agent-services/safe-fetch.test.ts after npm.cmd run build as part of the
  guarded local procedure, alongside the Stage 8 suites, with zero skips.
  Local success is not remote CI success; GitHub Actions remains unverified.
