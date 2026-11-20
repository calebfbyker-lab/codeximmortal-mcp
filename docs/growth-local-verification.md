# Local growth runtime verification

Status: PROVISIONAL / UNCERTIFIED. No CI identifier assigned.

## Preflight without running the swarm

From the repository root in Windows Command Prompt, after pulling this branch and installing dependencies:

```cmd
node scripts/growth-doctor.mjs
```

The script reads DATABASE_URL from the current process environment. Configure it privately with the actual credentials for a dedicated development database before running. Do not paste passwords into chat. No example password is supplied here: literal placeholder credentials cannot authenticate. URL passwords with special characters need percent-encoding.

The script checks database connectivity and existence of the two growth target tables, then checks the fixed loopback Ollama endpoint for llama3:latest. It performs no migrations, inference, service changes, password resets, or candidate reviews. It does not validate the full database schema, certify that a database is disposable, or prove successful inference.

- Authentication rejected: the server is reachable, but credentials must be corrected locally. A repository patch cannot discover an unknown password.
- Connection refused: check the configured PostgreSQL host, port, and running service.
- Missing tables: confirm the database is disposable before applying migrations.
- Ollama failure: check the local server and installed model.

Do not disable database authentication as part of this workflow. If earlier manual troubleshooting left temporary trust rules in pg_hba.conf, restore the original authenticated configuration before proceeding.

## Verification sequence

```cmd
git branch --show-current
git rev-parse --short HEAD
node --check scripts/growth-doctor.mjs
npm run build
node scripts/growth-doctor.mjs
```

Expected branch: feat/revenue-growth-runtime. Record the actual commit and outputs; a successful build does not prove database connectivity.

Only after verifying the configured database is disposable and authentication succeeds:

```cmd
set CODEX_MIGRATE_ACK=disposable-database-only
npm run growth:migrate
node scripts/growth-doctor.mjs
```

The acknowledgment is a human assertion, not technical enforcement of disposability. The migration runner skips based on target-table existence, not a verified migration ledger or schema checksum.

After a successful preflight:

```cmd
set GROWTH_LOCAL_AI=on
npm run growth:swarm -- --models llama3:latest --objective "Improve the owner dashboard review flow with evidence per proposal"
```

The swarm writes advisory candidates. No model weights are trained and no release is authorized. Local verification remains unverified until the owner supplies the actual command results.
