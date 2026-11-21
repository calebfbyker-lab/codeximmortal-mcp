# Reliable console chat (experimental / UNCERTIFIED)

Additive repair: launch chat_reliable.py instead of chat_console.py.
Existing launchers remain unchanged for rollback. No CI identifier allocated.

1. Stop sending retries. Wait for managed jobs, then stop the old console normally.
2. Pull the approved commit. Never remove workspace locks or kill unidentified processes.
3. Run:

       python -m unittest discover -s local-training/tests -p test_chat_transport.py -v
       python local-training/chat_reliable.py --model YOUR_INSTALLED_MODEL --diagnose
       python local-training/chat_reliable.py --model YOUR_INSTALLED_MODEL

Use your known working Python executable in place of python.
Open http://127.0.0.1:8767 and connect with the new terminal token.
Look for the heading: Local assistant chat - reliable transport (displayed with a middle dot).
Do not publish the token. Existing history is reused, not deleted.

Default idle timeout: 180 seconds. Total inference budget: 600 seconds.
Override with --idle-timeout and --total-timeout (10 <= idle <= total <= 1800).
The total timer shuts down the client socket even during a stalled stream.
Shutdown waits for bounded inference and existing managed jobs.
There is no cancel button. Closing the socket is not proof that Ollama stopped computation.
No automatic retry, model pull, process termination or model substitution is performed.
Only send another request after checking Ollama if a prior request timed out.

Thinking uses the model default. --think off/on is explicit and only appropriate for a model that supports it.
Thinking text is not displayed, stored or forwarded as an answer; only activity status is shown.
Answer generation is capped at 512 predicted tokens; token-limit completion is labeled.
keep_alive is 5m, not an indefinite GPU reservation.
Partial failed responses remain visible in memory, excluded from completed chat history.
Failed user turns remain in the audit transcript; consecutive unanswered prompts are collapsed for inference.
Diagnostics query fixed loopback /api/tags, /api/ps and /api/version, without starting inference.
Use an installed local chat-capable model. Owner must configure Ollama for local-only operation.
The application cannot attest to the local Ollama server's network behavior.

Validation: eight real loopback fake-server transport tests and JavaScript syntax check passed.
Covers delayed headers, idle/total timeouts, HTTP 404, malformed/truncated streams,
thinking without answer, normal streaming and output limits indicated by done_reason.
Not verified: real Ollama/model loading, Windows, browser rendering, full console HTTP regression.
The earlier five chat-core tests are separate; rerun them locally too.
This remains one read-only assistant, not a tool-enabled swarm or autonomous repair executor.
