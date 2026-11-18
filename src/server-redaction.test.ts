import { describe, expect, it, vi, type Mock } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ApiError } from "./agent-commerce/api.js";
import { createServer } from "./server.js";

type Dispatch = (name: string, args: Record<string, unknown>) => Promise<unknown>;
async function session(run: (client: Client, call: Mock<Dispatch>) => Promise<void>) {
  const call = vi.fn(async (_name: string, _args: Record<string, unknown>): Promise<unknown> => ({ ok: true }));
  const server = createServer([{ name: "test_tool", description: "Test fixture only",
    inputSchema: { type: "object" } }], call);
  const client = new Client({ name: "redaction-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    await run(client, call);
  } finally { await client.close(); await server.close(); }
}

describe("MCP public errors", () => {
  it("initializes and lists without executing or authenticating tools", async () => {
    await session(async (client, call) => {
      expect((await client.listTools()).tools.map(t => t.name)).toEqual(["test_tool"]);
      expect(call).not.toHaveBeenCalled();
    });
  });
  it("preserves successful tool responses", async () => {
    await session(async client => {
      const result = await client.callTool({ name: "test_tool", arguments: {} });
      expect(result.isError).not.toBe(true);
      expect(result.content).toEqual([{ type: "text", text: JSON.stringify({ ok: true }, null, 2) }]);
    });
  });
  it.each([
    new Error("postgres://user:secret@private/db bearer-secret"),
    "provider payment_client_secret", { message: "private" },
    new ApiError(503, "private_database_details"),
    new ApiError(500, "unauthorized"),
  ])("redacts unexpected exceptions: %#", async error => {
    await session(async (client, call) => {
      call.mockRejectedValueOnce(error);
      const result = await client.callTool({ name: "test_tool", arguments: {} });
      expect(result.isError).toBe(true);
      expect(result.content).toEqual([{ type: "text", text: JSON.stringify({ error: {
        code: "tool_execution_failed", retryable: false,
      } }) }]);
    });
  });
  it.each([[401, "unauthorized", false], [409, "idempotency_conflict", false],
    [429, "rate_limited", true], [503, "service_disabled", true]] as const)(
    "allows only reviewed code/status pairs: %s %s", async (status, code, retryable) => {
      await session(async (client, call) => {
        const error = new ApiError(status, code); error.message = "bearer-secret";
        call.mockRejectedValueOnce(error);
        const result = await client.callTool({ name: "test_tool", arguments: {} });
        expect(result.content).toEqual([{ type: "text", text: JSON.stringify({ error: { code, retryable } }) }]);
      });
    });
  it("does not echo an unknown tool name", async () => {
    await session(async (client, call) => {
      await expect(client.callTool({ name: "bearer-secret", arguments: {} })).rejects.toThrow("unknown_tool");
      expect(call).not.toHaveBeenCalled();
    });
  });
});
