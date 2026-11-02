# Persisted inquiry sandbox

Status: isolated experimental handler; UNCERTIFIED. Not mounted in the production router. No payment, grant, target fetching, quote issuance, or delivery code. Earlier three-service draft remains on hold. No CI identifier assigned.

Run acceptance tests: npm ci && npm test -- src/pilot/inquiries.test.ts
Run compile check: npm run build
Tests and compilation have not been executed by the authoring assistant. Record real CI results before merging or deployment.

Integration: import createInquiryApp from src/pilot/inquiries.ts, configure an absolute private storage directory outside the repository and a stable random secret of at least 32 characters. Serve only as a separately approved sandbox process. Do not change the existing production entrypoint for this experiment.

POST /pilot/inquiries requires Idempotency-Key (16-128 letters, numbers, underscore or hyphen), application/json, product_id endpoint-preflight-pilot, mode sandbox, currency USD, integer max_total_minor 100-10000, target_url public-looking HTTPS DNS name, and intended_use up to 1000 characters. No extra fields. Inquiry is not spending authorization. No contact email collected.

GET /pilot/inquiries/:id requires Authorization: Bearer <access_token>. Treat the token as secret; do not place it in URLs, analytics, or logs. POST replays return the same derived token to the holder of the original high-entropy idempotency key; protect that key too. Only a token hash is persisted. Keep the signing secret stable across restarts.

Storage: one private JSON file, exclusive directory writer lock, unique temporary file and atomic rename. Concurrent writers on the SAME filesystem serialize; other storage models unsupported. No in-memory fallback. Corrupt or inaccessible storage fails 503. Default cap is 100 inquiries. Back up the store privately. Operator must verify the mounted volume persists across restarts and redeployments; ephemeral Render storage is NOT durable. Atomic rename is not a power-loss durability guarantee. Do not use this sandbox store as a money ledger.

After a process crash a stale .writer-lock may remain. Stop all writers, back up and inspect the store, then remove the stale lock manually. Never auto-delete a lock that may belong to a live writer. The bounded lock wait otherwise returns 503.

Target validation is syntax-only: no DNS lookup or outbound fetching takes place. It does NOT establish public routability or ownership. Any future report fetcher requires independent SSRF controls, DNS/IP pinning, redirect validation, total deadlines and authorization review.

Deploy prerequisites: explicit owner approval, persistent storage verification, TLS reverse proxy, IP/client rate limits and request logs with token/header redaction. No app-level per-IP rate limiter is included; enforce one at ingress before public exposure. The global cap is not a substitute for abuse controls.

Acceptance scope: actual HTTP requests to a temporary localhost listener and temporary private directories; persistence across new app instances, concurrent idempotency, fingerprint conflict, bearer-token isolation, sandbox-only input, corrupt-store handling and 8 KB body cap. Tests use no external endpoints, payment provider or real money. They cannot validate market demand or willingness to pay.
