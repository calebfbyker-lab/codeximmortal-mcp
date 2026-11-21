# Gated dashboard and CLI patch

Experimental, unregistered, UNCERTIFIED; no registry or doctrine changes.

## Start

From the repository root, after all old dashboard/CLI jobs have finished:

    py -3 -m unittest discover -s local-training/tests -v
    py -3 local-training/dashboard_v2.py dashboard

Open http://127.0.0.1:8766 and enter the private terminal token. No train,
shell, cancel, archive, repository-write, deployment or promotion endpoint exists.
A port already in use causes startup to fail; no existing process is stopped.

CLI stages using the same workspace lock:

    py -3 local-training/dashboard_v2.py generate
    py -3 local-training/dashboard_v2.py filter
    py -3 local-training/dashboard_v2.py export
    py -3 local-training/dashboard_v2.py plan

## Exact safety boundary

The launcher uses exclusive-file creation for companion.lock across its own
processes. Existing lab.py commands DO NOT honor that lock. Do not run them
concurrently. Training must remain paused; the launcher cannot authorize it.
The legacy training.lock check cannot eliminate a race with a legacy process.
No system-wide serialization or production-hardening claim is made.

Normal Ctrl+C waits for non-daemon jobs to finish. Forced exit, a second
interrupt or power loss may lose generation results: v1 still writes raw.jsonl
only at generation completion. No checkpoint/resume or candidate count exists.
Stale companion.lock files are not automatically removed. Before recovering one,
verify all companion and training processes have stopped; preserve the lock
contents and inspect its PID/time before manually moving it aside. Never
remove a lock while its owner may be active.

Prerequisite checks reject missing/empty JSONL, malformed JSON, missing trace
fields and inadequate statistics. These are structural checks, not complete
provenance, freshness or semantic validation. Existing lab.py validators remain
responsible for stage-specific checks. The UI reports job state/results; it does
not claim artifact readiness or measured model improvement.

HTTP uses loopback Host/Origin/token checks, no request bodies, socket timeouts,
textContent rendering, and sequential timed polling. This is a single-user local
utility, not a multi-user service; do not proxy it externally.

lab.py, dashboard.html, config.json, corpus.json and tasks.json are unchanged.
The HTML is embedded in dashboard_v2.py, avoiding a separate missing asset.
Tests use a mocked backend: actual Ollama, Windows/browser operation, shutdown
under live generation, cross-process contention and GPU training remain unverified.

Rollback: finish active jobs, stop this launcher, then use the unchanged original
companion. Do not delete datasets, locks with active owners, or adapters.
