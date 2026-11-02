# Sandbox rate limiting and safe access logging

Use createSecuredInquiryApp from src/pilot/secured-inquiries.ts for any sandbox listener. The original createInquiryApp remains an unwrapped storage/router factory for low-level tests; it does NOT have the wrapper's rate limiting or access logs. No live entrypoint is modified by this patch.

Defaults: 30 requests per 60-second fixed window per socket IP, including GET and POST; at most 1000 tracked clients. Expired buckets are pruned on requests. Rejection returns 429, Retry-After and charged:false. Applies before request body parsing. Limits are in memory, reset on restart, and are not shared across instances. This is a bounded single-process pilot limiter, not distributed abuse prevention.

trust proxy is false: X-Forwarded-For is ignored to prevent client spoofing. Behind a proxy all requests may share one socket IP and the same limit. Configure an audited ingress-level per-client limiter before public deployment; do not simply enable trust proxy universally. Rate limiting does not replace the 100-inquiry global cap or persistent storage verification.

JSON access logs have ONLY event, random server request_id, allowlisted method, route TEMPLATE, status, duration_ms, authorization_present boolean and rate_limited boolean. No raw token, token hash/fingerprint, API key, idempotency key, inquiry ID, raw URL/query string, IP address, headers, request/response body or target URL is emitted. Logger errors do not break HTTP responses. Aborted connections before finish are not recorded by this minimal access logger.

Reverse proxy, hosting, APM and error logs require separate redaction configuration: this wrapper cannot redact logs produced elsewhere. Never log Authorization or response bodies containing access_token. Tokens in query strings are not supported authentication and must not be used.

Run: npm test -- src/pilot/inquiries.test.ts src/pilot/secured-inquiries.test.ts
Then: npm run build
Tests have been authored, not executed in this assistant session. Two additional HTTP tests cover rate-limit rejection before parsing, spoofed forwarding headers, window reset and absence of secret strings from logs. Existing storage tests exercise the underlying unwrapped factory.

Experimental and UNCERTIFIED. Three-service production draft stays on hold; no payments enabled, no CI identifier assigned.
