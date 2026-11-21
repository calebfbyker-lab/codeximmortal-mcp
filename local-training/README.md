# CodexImmortal local training companion — experimental / UNCERTIFIED

No CI number allocated. AX telemetry/certification/chaos/cost integrations are not implemented. Registry and doctrine unchanged. This is a bounded proof-of-pipeline, not a production self-training platform. It is additive to the growth runtime, not wired into its PostgreSQL or Express authorization layer.

## What is implemented
- Local Ollama synthetic multi-turn simulation logs; no shell/tool execution.
- Independent exact-answer verifier on every turn, deterministic task splits and full trace provenance.
- Reward-filtered SFT export and same-prefix DPO pairs; no fabricated negative answers and no model-as-judge rewards.
- LLaMA-Factory ShareGPT datasets and manifest; conversational JSONL for Unsloth/TRL consumers.
- Local SFT LoRA then DPO continuation configuration generation and explicit plan-hash-authorized execution.
- Fixed loopback dashboard actions to generate/filter/export/plan/status; arbitrary prompts, shell commands, training and deployment are not exposed.
- Tiny lexical RAG baseline and an owner-curated repeated context prefix. The prefix is CAG-inspired context augmentation, NOT implemented KV-cache reuse.

## Integration
Now part of this repository on the feat/revenue-growth-runtime branch. For offline installs, the distribution archive also contains scripts/install-local-training.ps1, which copies only a NEW local-training directory into a checkout, refuses overwrite/wrong branch, and does not edit package.json.

## Smoke test on Windows
From the project root:

    py -3 -m unittest discover -s local-training/tests -v
    py -3 local-training/lab.py status
    py -3 local-training/lab.py dashboard

Dashboard: http://127.0.0.1:8766 . Paste the freshly printed token into the password field, never into a URL. Token is in memory only and changes on restart. This is a single-user loopback utility, NOT protection against malware or another user/process with access to your account/terminal. Never reverse proxy or bind externally. Ctrl+C stops the server; daemon generation jobs may stop mid-cycle. Training is deliberately CLI-only.

## Generation and curation
Requires a pre-pulled local teacher whose license permits the intended use. Edit config.json to match your installed Ollama teacher. Starter defaults to previously used llama3:latest, not a guarantee it is installed/licensed for your use.

    py -3 local-training/lab.py generate
    py -3 local-training/lab.py filter
    py -3 local-training/lab.py export

Use either dashboard actions or CLI sequentially, not both concurrently. Each cycle refuses to replace raw.jsonl. Archive a cycle externally before restarting. Generation can make up to 288 calls with the starter task set; each call has a 120-second timeout. No unattended infinite loop or global GPU budget enforcement exists.

Storage defaults to LOCALAPPDATA/CodexImmortalTraining (home directory fallback off Windows), outside Git. Override CODEX_TRAIN_HOME with an absolute external path. Keep training/evidence directories owner-readable/writable only using OS ACLs. Logs/datasets/model outputs must never be committed. No repository scanning is performed, so real code/secrets are not ingested by default.

Starter tasks are only integer arithmetic simulations, not real agent benchmark trajectories. Passing them demonstrates plumbing, not improved coding or defense ability. The generator may produce too few mistakes for DPO pairs. The planner then FAILS CLOSED: do not lower thresholds or invent preferences just to run a training job. Expand owner-reviewed tasks and verifiers instead.

Preference pairs share the exact system/multi-turn history and compare a correct final answer with a verifier-rejected answer. All SFT turns must pass. Train/validation/test task IDs are disjoint, but starter tasks are structurally similar and do not establish meaningful generalization. Test traces are excluded from exports. No automated held-out model evaluation or promotion is implemented.

## Training backend
This package implements LLaMA-Factory execution, not a second Unsloth trainer. The exported JSONL is a starting dataset for Unsloth SFT/DPO APIs; pin/validate your selected versions and chat templates before use.

Use a separate Linux/WSL2 GPU environment with a compatible installed LLaMA-Factory stack, local HF-format student weights/tokenizer and an appropriate model template. An Ollama tag/GGUF file is not a substitute for a supported HF training checkpoint. Hardware, CUDA, VRAM and native Windows compatibility are NOT verified.

Do not copy arbitrary installation commands from generated text. Install LLaMA-Factory using its official supported environment instructions, record the exact source revision and freeze dependencies. This bundle intentionally does not assert an untested universal CUDA dependency lock. Run training in a disposable GPU VM/container with network egress denied, no repository write mount, no SSH/GitHub/PostgreSQL credentials and an OS-enforced resource budget. Offline environment variables prevent normal Hub downloads, but are NOT a network security boundary. Preinstall code and weights first.

Edit config.json: student_model_path (absolute local HF directory), template (correct backend template), license_reviewed=true only after actual review. Paths must be native to the training environment; do not reuse a Windows plan inside WSL.

    python local-training/lab.py plan
    python local-training/lab.py train --approve HASH_PRINTED_BY_PLAN

Plan files are JSON documents with .yaml extension (valid YAML). The runner executes fixed llamafactory-cli train commands without a shell, hashes datasets/configs and verifies that the reviewed plan still matches. Base model config is hashed, but full model weight/tokenizer integrity is NOT attested. Keep the model directory read-only and verify its upstream manifest independently. CLI authority is possession of the OS account/plan hash, not remote identity authentication.

SFT creates a candidate adapter; DPO continues that adapter into a separate output. Training is offline, bounded by max_steps and a per-stage timeout. Timeout kills only the direct process; distributed/child-process cleanup needs OS job objects/cgroups and is not guaranteed by this prototype. Do not use distributed launch until supervised containment exists. Failures can leave partial adapters: inspect/archive, never blindly resume. Do not run two cycles simultaneously. Runtime training lock prevents two trainer executions but is not a distributed lock.

    python local-training/lab.py cycle

cycle automates generation -> filtering -> export -> plan, not expensive training authorization. The authorized train command runs both training stages automatically. Neither command promotes, merges, deploys, changes live Ollama models, or edits source code.

## Distillation / RAG / CAG / neural networks
Teacher-output SFT is response-based distillation, conditional on dataset quality. No teacher logits or KL objective are implemented. DPO learns chosen-vs-rejected preferences. LoRA adapts part of an existing neural network; it does not construct a new architecture or prove capability gains.

RAG uses a tiny lexical ranker over an owner-curated corpus; no embeddings/vector database. Repeated context is not persistent KV-cache CAG. Future upgrades require independent evals, corpus provenance and no retrieved instruction authority. Keep real privileged traces out until secret/PII scans and owner approval exist.

## Promotion gate (not implemented)
Evaluate base vs SFT vs DPO against protected realistic held-out tasks, safety checks, latency and resource budgets. Reject regressions. Owner must approve adapter/model registry promotion, runtime changes, exports and releases. Existing growth worker remains unchanged and should stay paused until separately verified. See REPOSITORY-SECURITY.md for public-repo ownership limits.
