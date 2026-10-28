import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server.js";
import { loadTools, findProjectFile } from "./load-tools.js";
import { loadCatalog } from "./catalog.js";
import { dispatchTool } from "./dispatch.js";

const app = express();
app.use(express.json());

const tools = loadTools();
const catalog = loadCatalog();

app.get("/.well-known/agent-card.json", (_req, res) => {
  res.type("application/json");
  res.send(findProjectFile("well-known/agent-card.json"));
});

app.get("/api/v1/catalog.json", (_req, res) => {
  res.type("application/json");
  res.send(JSON.stringify(catalog));
});

app.post("/mcp", async (req, res) => {
  try {
    const server = createServer(tools, dispatchTool);
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
  res.json({ ok: true, tools: tools.length, offers: catalog.offers.length });
});

const port = Number(process.env.PORT ?? 8080);
app.listen(port, () => {
  console.log(`codeximmortal-mcp http listening on ${port}`);
});
