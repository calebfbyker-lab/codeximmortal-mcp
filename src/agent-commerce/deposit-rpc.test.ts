import { describe, expect, it, vi } from "vitest";
import { createRpcClient, decodeTransferLog, padAddress, TRANSFER_TOPIC, type EvmLog } from "./deposit-rpc.js";

const token = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
const sender = "0x3333333333333333333333333333333333333333";
const recipient = "0x2222222222222222222222222222222222222222";

function padTopic(address: string): string {
  return "0x000000000000000000000000" + address.slice(2).toLowerCase();
}
function logFor(overrides: Partial<EvmLog> = {}): EvmLog {
  return {
    transactionHash: "0x" + "ab".repeat(32),
    logIndex: "0x0",
    blockNumber: "0x50",
    address: token,
    topics: [TRANSFER_TOPIC, padTopic(sender), padTopic(recipient)],
    data: "0x" + (500000000n).toString(16).padStart(64, "0"),
    ...overrides,
  };
}

describe("deposit rpc helpers", () => {
  it("pads and validates addresses", () => {
    const address = "0x" + "ab".repeat(19) + "cd";
    expect(padAddress(address)).toBe("0x" + "0".repeat(24) + "ab".repeat(19) + "cd");
    expect(() => padAddress("0x1234")).toThrow("invalid_address");
  });
  it("decodes a valid transfer log", () => {
    expect(decodeTransferLog(logFor())).toEqual({
      txHash: "0x" + "ab".repeat(32), logIndex: 0, blockNumber: 80n,
      token, from: sender, to: recipient, value: 500000000n,
    });
  });
  it("rejects malformed logs", () => {
    expect(decodeTransferLog(logFor({ topics: [TRANSFER_TOPIC, padTopic(sender)] }))).toBeNull();
    expect(decodeTransferLog(logFor({ topics: ["0x" + "00".repeat(32), padTopic(sender), padTopic(recipient)] }))).toBeNull();
    expect(decodeTransferLog(logFor({ transactionHash: "0x1234" }))).toBeNull();
    expect(decodeTransferLog(logFor({ data: "not-hex" }))).toBeNull();
    expect(decodeTransferLog(logFor({ logIndex: "zz" }))).toBeNull();
  });
  it("rejects insecure rpc endpoints", () => {
    expect(() => createRpcClient("http://rpc.example.test")).toThrow("invalid_rpc_endpoint");
    expect(() => createRpcClient("https://user:pass@rpc.example.test")).toThrow("invalid_rpc_endpoint");
    expect(() => createRpcClient("not-a-url")).toThrow("invalid_rpc_endpoint");
  });
  it("calls the endpoint with a JSON-RPC envelope and parses results", async () => {
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x64" }),
      { headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    const client = createRpcClient("https://rpc.example.test", fetchImpl);
    expect(await client.blockNumber()).toBe(100n);
    const init = vi.mocked(fetchImpl).mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body)).method).toBe("eth_blockNumber");
  });
  it("rejects rpc error envelopes and non-ok responses", async () => {
    const failing = vi.fn(async () => new Response(
      JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32000 } }))) as unknown as typeof fetch;
    await expect(createRpcClient("https://rpc.example.test", failing).blockNumber()).rejects.toThrow("rpc_request_failed");
    const notOk = vi.fn(async () => new Response("gone", { status: 500 })) as unknown as typeof fetch;
    await expect(createRpcClient("https://rpc.example.test", notOk).blockNumber()).rejects.toThrow("rpc_request_failed");
  });
  it("filters invalid logs from getLogs results", async () => {
    const logs = [logFor(), { transactionHash: "0x12", logIndex: "0x1", blockNumber: "0x50", address: token, topics: [TRANSFER_TOPIC], data: "0x" }];
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({ jsonrpc: "2.0", id: 1, result: logs }),
      { headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    const client = createRpcClient("https://rpc.example.test", fetchImpl);
    const result = await client.getLogs({ fromBlock: 1n, toBlock: 10n, address: token, topics: [TRANSFER_TOPIC, null, padAddress(recipient)] });
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(logs[0]);
  });
});
