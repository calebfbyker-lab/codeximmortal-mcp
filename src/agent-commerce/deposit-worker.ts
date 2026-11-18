import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import { PostgresFunding } from "./postgres-funding.js";
import { createRpcClient, decodeTransferLog, padAddress, TRANSFER_TOPIC, type RpcClient } from "./deposit-rpc.js";

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`missing_configuration:${key}`);
  return value;
}

/**
 * Deposit verification worker. Money verification happens here; accounting
 * happens exclusively in PostgresFunding.credit. A scan cursor advances only
 * after every log in its range settled or was safely skipped, so a credit
 * failure (database unavailable) retries on the next poll. Unmatched transfers
 * are logged, never written as funding events, so a later matching intent can
 * still claim them; reconciliation tooling for persistently unmatched funds
 * is future work.
 */
export class CryptoDepositWorker {
  private readonly s: string;
  private readonly confirmations: number;
  private readonly pollMs: number;
  constructor(
    private readonly pool: Pool,
    private readonly funding: PostgresFunding,
    private readonly rpc: RpcClient,
    schema = "agent_commerce",
    confirmations = 12,
    pollMs = 30_000,
  ) {
    if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) throw new Error("invalid_commerce_schema");
    if (!Number.isInteger(confirmations) || confirmations < 1 || confirmations > 1000) throw new Error("invalid_deposit_configuration");
    if (!Number.isInteger(pollMs) || pollMs < 1000 || pollMs > 3_600_000) throw new Error("invalid_deposit_configuration");
    this.s = `"${schema}"`;
    this.confirmations = confirmations;
    this.pollMs = pollMs;
  }

  async runOnce(): Promise<string> {
    const packages = await this.pool.query(
      `SELECT network, token_contract, recipient_address FROM ${this.s}.funding_packages WHERE active`);
    if (!packages.rowCount) return "idle";
    let processed = 0;
    for (const pkg of packages.rows) {
      const token = String(pkg.token_contract).toLowerCase();
      const recipient = String(pkg.recipient_address).toLowerCase();
      const scanKey = `${pkg.network}:${token}:${recipient}`;
      const head = await this.rpc.blockNumber();
      const target = head - BigInt(this.confirmations);
      if (target < 1n) continue;
      const cursor = await this.pool.query(
        `SELECT last_block FROM ${this.s}.funding_scan_cursors WHERE scan_key=$1`, [scanKey]);
      const from = (cursor.rowCount ? BigInt(cursor.rows[0].last_block) : 0n) + 1n;
      if (from > target) continue;
      const logs = await this.rpc.getLogs({
        fromBlock: from, toBlock: target, address: String(pkg.token_contract),
        topics: [TRANSFER_TOPIC, null, padAddress(String(pkg.recipient_address))],
      });
      for (const log of logs) {
        const transfer = decodeTransferLog(log);
        // Guards against a misbehaving RPC returning logs outside the
        // requested range, token or recipient.
        if (!transfer || transfer.token !== token || transfer.to !== recipient) continue;
        if (transfer.blockNumber < from || transfer.blockNumber > target) continue;
        const matched = await this.pool.query(
          `SELECT provider_ref, amount_minor, currency, expires_at > clock_timestamp() AS live
             FROM ${this.s}.funding_orders
            WHERE provider='crypto' AND status='pending' AND network=$1 AND token_contract=$2
              AND recipient_address=$3 AND amount_atomic=$4`,
          [pkg.network, pkg.token_contract, pkg.recipient_address, transfer.value.toString()]);
        if (matched.rowCount === 1 && matched.rows[0].live === true) {
          const row = matched.rows[0];
          await this.funding.credit({
            provider: "crypto",
            providerEventId: `${transfer.txHash}:${transfer.logIndex}`,
            providerRef: row.provider_ref,
            amountMinor: Number(row.amount_minor),
            currency: row.currency,
            evidence: {
              txHash: transfer.txHash, logIndex: transfer.logIndex, blockNumber: transfer.blockNumber.toString(),
              from: transfer.from, network: pkg.network, token, valueAtomic: transfer.value.toString(),
            },
          });
          processed++;
        } else {
          // rowCount > 1 is impossible under the pending-atomic unique index.
          console.error(JSON.stringify({ event: "deposit_unmatched", network: pkg.network }));
        }
      }
      // Advance only after every log in the range settled or was safely
      // skipped; a thrown credit failure leaves the cursor for the next poll.
      await this.pool.query(
        `INSERT INTO ${this.s}.funding_scan_cursors(scan_key, network, last_block, updated_at)
         VALUES($1,$2,$3,clock_timestamp())
         ON CONFLICT(scan_key) DO UPDATE SET last_block=EXCLUDED.last_block, updated_at=clock_timestamp()`,
        [scanKey, pkg.network, target.toString()]);
    }
    return processed > 0 ? "processed" : "idle";
  }

  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try { await this.runOnce(); }
      catch { console.error(JSON.stringify({ event: "deposit_worker_iteration_failed" })); }
      await delay(this.pollMs, undefined, { signal }).catch(() => undefined);
    }
  }
}

export interface DepositWorkerEnvironment {
  run(signal: AbortSignal): Promise<void>;
  runOnce(): Promise<string>;
  close(): Promise<void>;
}

/**
 * Environment-gated process entrypoint, disabled unless explicitly enabled
 * with the reviewed authority acknowledgement. Run with:
 * AGENT_DEPOSIT_WORKER_ENABLED=true node dist/agent-commerce/deposit-worker.js
 */
export function depositWorkerFromEnvironment(env: NodeJS.ProcessEnv = process.env): DepositWorkerEnvironment {
  if (env.AGENT_DEPOSIT_WORKER_ENABLED !== "true") throw new Error("deposit_worker_disabled");
  if (env.AGENT_COMMERCE_AUTHORITY_CONTRACT !== "postgres-commerce-v1-reviewed") throw new Error("authority_contract_not_reviewed");
  const databaseUrl = required(env, "AGENT_COMMERCE_DATABASE_URL");
  const rpcEndpoint = required(env, "DEPOSIT_RPC_URL");
  const confirmations = env.DEPOSIT_CONFIRMATIONS ? Number(env.DEPOSIT_CONFIRMATIONS) : 12;
  const pollSeconds = env.DEPOSIT_POLL_SECONDS ? Number(env.DEPOSIT_POLL_SECONDS) : 30;
  if (!Number.isInteger(confirmations) || confirmations < 1 || confirmations > 1000) throw new Error("invalid_deposit_configuration");
  if (!Number.isInteger(pollSeconds) || pollSeconds < 5 || pollSeconds > 3600) throw new Error("invalid_deposit_configuration");
  const pool = new Pool({ connectionString: databaseUrl, max: 4, connectionTimeoutMillis: 3000, statement_timeout: 15000 });
  pool.on("error", () => console.error(JSON.stringify({ event: "deposit_worker_pool_error" })));
  const worker = new CryptoDepositWorker(pool, new PostgresFunding(pool), createRpcClient(rpcEndpoint), "agent_commerce", confirmations, pollSeconds * 1000);
  return { run: signal => worker.run(signal), runOnce: () => worker.runOnce(), close: () => pool.end() };
}

export async function main(): Promise<void> {
  const worker = depositWorkerFromEnvironment();
  const controller = new AbortController();
  const shutdown = (signal: string) => {
    console.error(JSON.stringify({ event: "deposit_worker_shutdown", signal }));
    controller.abort();
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  try { await worker.run(controller.signal); }
  finally { await worker.close(); }
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch(error => {
    console.error(JSON.stringify({ event: "deposit_worker_failed", code: error instanceof Error ? error.message : "unknown" }));
    process.exitCode = 1;
  });
}
