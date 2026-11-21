# Durable delegation fixture (UNCERTIFIED)

Opt-in launcher: `a2a_fixture.py`. Existing chat launchers remain unchanged.
This is a restricted experimental SendMessage/GetTask subset, not full A2A
conformance. MCP 2026-07-28 is a compatibility target only: no MCP adapter is
implemented or enabled. No new CI number or canonical registry change.

## Scope
- SQLite durable task receipts, queue, event sequence and artifacts outside repo.
- Exactly one deterministic worker, 8 outstanding tasks, 60-second queue deadline.
- Three synthetic stages, zero spawned children and zero model calls.
- Read-only means no repository access or mutation; only service-owned DB writes.
- Interrupted WORKING tasks fail on restart, rather than silently replaying.
- Pending fixture tasks may resume. Successful receipts survive restart.
- No shell, network fetch, training, application of patches or tool execution.
- All access maps to one configured local owner; not a multi-tenant service.
- Separate ephemeral A2A and console credentials; neither stored in browser storage.
- Loopback HTTP only; do not expose publicly. No CORS or remote binding added.
- Task history has a 1000-task pilot quota; archive through an operator-reviewed
  future maintenance path, not by deleting audit evidence automatically.

## Setup and checks
Use a dedicated virtual environment with existing console requirements plus
`python -m pip install -r local-training/requirements-a2a-fixture.txt`.
Dependencies require network access unless available in an approved local cache.
The direct SDK pin is not a complete transitive/hash lock or supply-chain audit.
Run `python -m unittest discover -s local-training/tests -p test_delegation_fixture.py -v`.
The GeneratedTypesTests test MUST run without skips before local acceptance.
Core and HTTP tests explicitly use a codec double and do not prove SDK conformance.
Also run existing workspace and transport suites. Windows/browser and actual
SDK-client interoperability remain separate acceptance checks.

After gracefully stopping the old console and releasing companion.lock, launch:
`python -u local-training/a2a_fixture.py --model llama3:latest --port 8767`.
The existing chat uses Llama; the new delegation panel uses ONLY the synthetic
fixture. Click Run synthetic fixture, then Refresh task. Test restart recovery.
A2A discovery: GET /.well-known/agent-card.json. JSON-RPC: POST /a2a with
A2A-Version: 1.0 and the separate A2A token. Dashboard requests use authenticated
same-origin /api/delegation with the console token. Never share either token.

## Next gates
No three-stage Llama delegation until pinned generated-type, authorization,
persistence, deduplication and Windows browser acceptance pass. Then add approved
context bundles and sequential model calls with shared budgets. AX telemetry,
verification and exercises are prerequisites for broader autonomous expansion.
No model promotion or training is authorized by this fixture.
Rollback: stop normally and run chat_workspace.py. Fixture DB is preserved.
