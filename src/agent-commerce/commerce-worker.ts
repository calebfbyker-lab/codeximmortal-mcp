import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import { ApiError } from "./api.js";
import { DurableWorker } from "./durable-worker.js";
import type { ExecutionContext, Providers, SnapshotRead } from "./worker.js";
import { SnapshotProvider } from "../agent-services/snapshot-provider.js";
import { SafeFetchAdapter, type SafeFetchDeps } from "../agent-services/safe-fetch.js";
import { PostgresSnapshotSourceStore } from "../persistence/postgres-snapshot-source-store.js";
import { PostgresSnapshotSink } from "../persistence/postgres-snapshot-sink.js";
import { PostgresSnapshotRepository } from "../persistence/postgres-snapshot-repository.js";

export interface CommerceWorkerProcess {
  run(signal: AbortSignal): Promise<void>;
  runOnce(): Promise<string>;
}

/**
 * Production provider composition for the durable commerce worker: the real
 * snapshot provider (buyer-owned sources, hardened safe fetch, durable sink),
 * consistent pair reads through the snapshot repository, and a fail-closed
 * document_extract stub that has no provider implementation in this build.
 * The worker itself owns all accounting and settlement; providers never touch
 * wallet or ledger state.
 */
export function composeCommerceWorkerProviders(pool: Pool, options: { fetchDeps?: SafeFetchDeps } = {}): Providers {
  const capture = new SnapshotProvider(
    new PostgresSnapshotSourceStore(pool),
    new SafeFetchAdapter({ deps: options.fetchDeps }),
    new PostgresSnapshotSink(pool),
  );
  const repository = new PostgresSnapshotRepository(pool);
  const read = (entry: { snapshot: unknown; completeCoverageVerified: boolean }): SnapshotRead =>
    ({ value: entry.snapshot, completeTrusted: entry.completeCoverageVerified === true });
  return {
    capture: (p, sourceId, context) => capture.capture(p, sourceId, context),
    snapshot: async (p, id) => {
      // A single read is the degenerate consistent pair (same id both sides);
      // one statement observes the row, buyer-scoped and owner-checked.
      const pair = await repository.findOwnedPair(p.buyerId, id, id);
      return pair ? read(pair.before) : null;
    },
    snapshotPair: async (p, beforeId, afterId) => {
      const pair = await repository.findOwnedPair(p.buyerId, beforeId, afterId);
      return pair ? { before: read(pair.before), after: read(pair.after) } : { before: null, after: null };
    },
    // document_extract has no provider implementation in this build. Admission
    // does not price or admit it; if a job somehow exists it fails closed here,
    // retries to exhaustion, and settles as a failed job with a receipt.
    extract: async () => { throw new ApiError(503, "service_disabled"); },
  };
}

/**
 * Composes the durable worker over an existing pool. The caller owns the pool:
 * this function never ends it. Environment construction below owns its pool
 * and closes it explicitly.
 */
export function composeCommerceWorker(options: { pool: Pool; schema?: string; leaseSeconds?: number; fetchDeps?: SafeFetchDeps }): CommerceWorkerProcess {
  const providers = composeCommerceWorkerProviders(options.pool, { fetchDeps: options.fetchDeps });
  const worker = new DurableWorker(options.pool, providers, options.schema, options.leaseSeconds);
  return { run: signal => worker.run(signal), runOnce: () => worker.runOnce() };
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`missing_configuration:${key}`);
  return value;
}

export interface CommerceWorkerEnvironment extends CommerceWorkerProcess {
  close(): Promise<void>;
}

/**
 * Environment-gated process entrypoint. Disabled unless explicitly enabled
 * with the same reviewed authority acknowledgement as the commerce API.
 * Run with: AGENT_COMMERCE_WORKER_ENABLED=true node dist/agent-commerce/commerce-worker.js
 */
export function commerceWorkerFromEnvironment(env: NodeJS.ProcessEnv = process.env): CommerceWorkerEnvironment {
  if (env.AGENT_COMMERCE_WORKER_ENABLED !== "true") throw new Error("commerce_worker_disabled");
  if (env.AGENT_COMMERCE_AUTHORITY_CONTRACT !== "postgres-commerce-v1-reviewed") throw new Error("authority_contract_not_reviewed");
  const databaseUrl = required(env, "AGENT_COMMERCE_DATABASE_URL");
  const pool = new Pool({ connectionString: databaseUrl, max: 4, connectionTimeoutMillis: 3000, statement_timeout: 15000 });
  pool.on("error", () => console.error(JSON.stringify({ event: "commerce_worker_pool_error" })));
  const process = composeCommerceWorker({ pool });
  return { run: process.run, runOnce: process.runOnce, close: () => pool.end() };
}

export async function main(): Promise<void> {
  const worker = commerceWorkerFromEnvironment();
  const controller = new AbortController();
  const shutdown = (signal: string) => {
    console.error(JSON.stringify({ event: "commerce_worker_shutdown", signal }));
    controller.abort();
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  try {
    await worker.run(controller.signal);
  } finally {
    await worker.close();
  }
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch(error => {
    console.error(JSON.stringify({ event: "commerce_worker_failed", code: error instanceof Error ? error.message : "unknown" }));
    process.exitCode = 1;
  });
}
