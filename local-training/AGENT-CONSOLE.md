# Local Agent Console (experimental, UNCERTIFIED)

This additive console does not replace dashboard_v2.py or adopt existing processes.
It supervises fixed local subprocesses; it is NOT a sandboxed autonomous code-repair system.
No automatic repository edits, commits, pushes, upgrades or model promotion occur.

## Windows startup
From the outer codeximmortal-mcp checkout, in your trusted Python environment:

    py -3 -m pip install -r local-training/requirements-console.txt
    py -3 -m unittest discover -s local-training/tests -p test_agent_console.py -v
    py -3 local-training/agent_console.py

Visit http://127.0.0.1:8767 and enter the new private terminal token.
First let old dashboard jobs finish and stop that server; its companion.lock conflicts intentionally.
Never delete a lock until you have verified every related job stopped.

## Implemented controls and real telemetry
- Observer: git status --short --branch (no optional Git locks).
- Verifier: git diff --check (checks whitespace, NOT functional correctness).
- Generator/filter/export/planner: existing lab.py functions in separate workers.
- Training: review plan, enter exact SHA-256, confirm launch; existing lab.train revalidates inputs.
- Pause/resume: admission control only; active jobs keep running.
- Restart: idle-only rerun, never an interrupt or automatic retry.
- One job at a time; no schedule is enabled automatically.
- Process tree CPU and RSS sampled on status requests every ~1.5 seconds.
  CPU 100% means one logical core; RSS may double-count shared pages.
  External Ollama/GPU usage is NOT assigned to agents; first CPU sample is warm-up.
- Events/output: SQLite outside repo, last 5000 bounded chunks retained; UI tails with event IDs.
  Historical events persist but process state is session-local. Do not launch multiple consoles.

## Boundaries
No arbitrary terminal input: terminal is stdout/stderr display for fixed scripts.
No repairing status is fabricated: repair/upgrade execution is explicitly unavailable.
Learning labels mean data processing, not demonstrated model improvement.
Generation still has no checkpoints/progress events. Forced shutdown may lose work.
Normal shutdown waits for jobs. Existing training timeout cannot guarantee descendant cleanup.
Legacy lab.py invocations bypass companion.lock; never run those concurrently.
Loopback token/Host/Origin checks are not multi-user or malware protection.
Logs are not secret-scrubbed: do not use sensitive datasets. No HTTP log download route.
Run under an unprivileged account without GitHub/database credentials.
Model artifacts are local code/data: trust and review them before execution.
This is process supervision, not OS isolation. Model/command dependencies need local validation.

## Validation performed
Five tests: real subprocess output and completion, pause/allowlist, concurrent restart rejection,
metric/cursor shape, live HTTP authorization and unknown-endpoint rejection.
No actual Ollama, LoRA, Windows/browser, full companion regression, or AI repair test was run.

Next work: isolated patch workspace, independent functional verifier, owner application queue,
and durable candidate-level generation checkpoints. No CI identity allocated.
