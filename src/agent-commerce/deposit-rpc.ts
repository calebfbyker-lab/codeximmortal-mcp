export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const HEX = /^0x[0-9a-fA-F]+$/;
const HASH32 = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export interface EvmLog {
  transactionHash: string;
  logIndex: string;
  blockNumber: string;
  address: string;
  topics: string[];
  data: string;
}

export interface VerifiedTransfer {
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  token: string;
  from: string;
  to: string;
  value: bigint;
}

export interface LogFilter {
  fromBlock: bigint;
  toBlock: bigint;
  address: string;
  topics: Array<string | null>;
}

export interface RpcClient {
  blockNumber(): Promise<bigint>;
  getLogs(filter: LogFilter): Promise<EvmLog[]>;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function hexToBigInt(hex: string): bigint {
  if (typeof hex !== "string" || hex.length <= 2 || !HEX.test(hex)) throw new Error("invalid_hex");
  return BigInt(hex);
}

export function padAddress(address: string): string {
  if (typeof address !== "string" || !ADDRESS.test(address)) throw new Error("invalid_address");
  // Strip the 0x prefix before padding: the padded topic is exactly 66
  // characters. The earlier version concatenated the prefixed address and
  // emitted malformed 68-character topics, breaking every getLogs filter.
  return "0x" + "0".repeat(24) + address.slice(2).toLowerCase();
}

function topicAddress(topic: string): string {
  if (!HASH32.test(topic)) throw new Error("invalid_topic");
  return "0x" + topic.slice(26).toLowerCase();
}

/** Strict decode of an ERC-20 Transfer log; null for anything malformed. */
export function decodeTransferLog(log: EvmLog): VerifiedTransfer | null {
  if (!isObject(log)) return null;
  if (typeof log.transactionHash !== "string" || !HASH32.test(log.transactionHash)) return null;
  if (!Array.isArray(log.topics) || log.topics.length !== 3 || log.topics.some(t => typeof t !== "string" || !HASH32.test(t))) return null;
  if (log.topics[0].toLowerCase() !== TRANSFER_TOPIC) return null;
  if (typeof log.address !== "string" || !ADDRESS.test(log.address)) return null;
  try {
    const logIndex = Number(log.logIndex);
    if (!Number.isSafeInteger(logIndex) || logIndex < 0) return null;
    const blockNumber = hexToBigInt(log.blockNumber);
    const value = log.data === "0x" ? 0n : hexToBigInt(log.data);
    return {
      txHash: log.transactionHash.toLowerCase(),
      logIndex,
      blockNumber,
      token: log.address.toLowerCase(),
      from: topicAddress(log.topics[1]),
      to: topicAddress(log.topics[2]),
      value,
    };
  } catch { return null; }
}

/**
 * Minimal HTTPS-only JSON-RPC client for deposit verification. The endpoint
 * comes from operator configuration, never request input; credentials in the
 * URL are rejected. All failures collapse to a single redacted error.
 */
export function createRpcClient(endpoint: string, fetchImpl: typeof fetch = globalThis.fetch): RpcClient {
  if (typeof endpoint !== "string" || endpoint.length > 2048) throw new Error("invalid_rpc_endpoint");
  let url: URL;
  try { url = new URL(endpoint); } catch { throw new Error("invalid_rpc_endpoint"); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error("invalid_rpc_endpoint");
  let nextId = 1;
  async function call(method: string, params: unknown[]): Promise<unknown> {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
    });
    if (!response.ok) throw new Error("rpc_request_failed");
    const body: unknown = await response.json().catch(() => { throw new Error("rpc_request_failed"); });
    if (!isObject(body) || "error" in body || !("result" in body)) throw new Error("rpc_request_failed");
    return body.result;
  }
  function validLog(value: unknown): value is EvmLog {
    return isObject(value)
      && typeof value.transactionHash === "string" && HASH32.test(value.transactionHash)
      && typeof value.logIndex === "string" && HEX.test(value.logIndex)
      && typeof value.blockNumber === "string" && HEX.test(value.blockNumber)
      && typeof value.address === "string" && ADDRESS.test(value.address)
      && Array.isArray(value.topics) && value.topics.every(t => typeof t === "string" && HASH32.test(t))
      && typeof value.data === "string" && (value.data === "0x" || HEX.test(value.data));
  }
  return {
    async blockNumber(): Promise<bigint> {
      const result = await call("eth_blockNumber", []);
      if (typeof result !== "string" || !HEX.test(result)) throw new Error("rpc_invalid_response");
      return BigInt(result);
    },
    async getLogs(filter: LogFilter): Promise<EvmLog[]> {
      const result = await call("eth_getLogs", [{
        fromBlock: "0x" + filter.fromBlock.toString(16),
        toBlock: "0x" + filter.toBlock.toString(16),
        address: filter.address,
        topics: filter.topics,
      }]);
      if (!Array.isArray(result) || result.length > 1000) throw new Error("rpc_invalid_response");
      return result.filter(validLog);
    },
  };
}
