#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { loadTools } from "./load-tools.js";
import { dispatchTool } from "./dispatch.js";

const tools = loadTools();
const server = createServer(tools, dispatchTool);
await server.connect(new StdioServerTransport());
