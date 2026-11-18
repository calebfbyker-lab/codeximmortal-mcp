import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ListToolsRequestSchema, CallToolRequestSchema, ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { publicToolError } from "./agent-commerce/mcp-errors.js";

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

export function createServer(tools: ToolDef[], callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>): Server {
  const server = new Server({ name: "codeximmortal", version: "1.1.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      ...(t.annotations ? { annotations: t.annotations } : {}),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    if (!tools.some((t) => t.name === name)) {
      throw new McpError(ErrorCode.InvalidParams, "unknown_tool");
    }
    try {
      const result = await callTool(name, (args ?? {}) as Record<string, unknown>);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      const error = publicToolError(err);
      return { content: [{ type: "text", text: JSON.stringify({ error }) }], isError: true };
    }
  });

  return server;
}
