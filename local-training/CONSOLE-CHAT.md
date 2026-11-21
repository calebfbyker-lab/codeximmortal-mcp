# Console chat (experimental / UNCERTIFIED)

Additive launcher; original agent_console.py and HTML remain unchanged.

1. Let current jobs finish, then stop the old console normally. Never bypass companion.lock.
2. Run `ollama list` in a separate terminal. Select an installed local chat-capable model.
3. From the outer repo run:

       py -3 local-training/chat_console.py --model YOUR_INSTALLED_MODEL_TAG

   If bypassing the launcher, use your actual python.exe with the same script and arguments.
4. Open http://127.0.0.1:8767, enter the newly printed token, click Connect, and send a message.
   Optional: `--port 8768`. Ollama must already be listening on 127.0.0.1:11434.

Chat uses a separate conversational prompt, not the arithmetic generator.
Replies stream from Ollama; the browser polls partial text once per second.
There is one shared owner conversation, saved outside the repo in chat.sqlite3 (last 40 messages).
Each inference receives at most 12 recent messages plus a current console snapshot.
No arbitrary files/logs are loaded into chat. Do not enter secrets. No delete-history UI yet.
Fixed loopback endpoint with proxies disabled; configure Ollama local-only and use local weights.
No remote model/service is intentionally selected by this code, but Ollama's own configuration is owner-controlled.

The model has NO tools: it cannot run commands, repair files, delegate, launch jobs, or train.
Use existing explicit controls for jobs and exact-plan-approved training.
One assistant is implemented, not a multi-agent swarm. Model text is unverified advice.
Managed jobs and chat inference reject overlapping launches; external processes remain untracked.
Pause blocks new chat turns but does not interrupt an active response.
No cancellation endpoint. Socket timeout 30 seconds; stream deadline checked between records at 180 seconds.
Normal shutdown waits. Forced exit can lose an unfinished reply or legacy generation work.
Only run on loopback under a trusted, unprivileged local account. This is not multi-user isolation.

Validation: five core tests with mocked console/inference and JavaScript syntax check.
Not validated: real Ollama, full HTTP integration with existing console, Windows/browser, full regression suite.
No training or repository changes were executed by chat. No CI identity allocated.
