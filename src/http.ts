import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server.js";
import { loadTools } from "./load-tools.js";
import { callGatewayTool } from "./gateway.js";

const app = express();
app.use(express.json());

const tools = loadTools();

app.post("/mcp", async (req, res) => {
  try {
    const server = createServer(tools, callGatewayTool);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message } });
  }
});

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, tools: tools.length });
});

const port = Number(process.env.PORT ?? 8080);
app.listen(port, () => {
  console.log(`codeximmortal-mcp http listening on ${port}`);
});
