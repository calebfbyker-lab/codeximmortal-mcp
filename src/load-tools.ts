import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { ToolDef } from "./server.js";

export function findProjectFile(fileName: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "..", fileName),
    join(here, "../..", fileName),
    join(here, "../../..", fileName),
    join(process.cwd(), fileName),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return readFileSync(candidate, "utf8");
    }
  }
  throw new Error(`unable to locate ${fileName} relative to ${here}`);
}

export function loadTools(): ToolDef[] {
  const manifest = JSON.parse(findProjectFile("mcp-manifest.json"));
  const raw = manifest.tools as Array<Record<string, unknown>>;
  if (!Array.isArray(raw)) {
    throw new Error("mcp-manifest.json: 'tools' must be an array");
  }
  return raw.map((tool) => {
    if (typeof tool.name !== "string" || typeof tool.description !== "string") {
      throw new Error("mcp-manifest.json: each tool needs name and description");
    }
    const inputSchema =
      (tool.inputSchema ?? tool.input_schema) as Record<string, unknown> | undefined;
    if (!inputSchema || typeof inputSchema !== "object") {
      throw new Error(`mcp-manifest.json: tool ${tool.name} is missing inputSchema`);
    }
    return {
      name: tool.name,
      description: tool.description,
      inputSchema,
      ...(tool.annotations
        ? { annotations: tool.annotations as Record<string, unknown> }
        : {}),
    };
  });
}
