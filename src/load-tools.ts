import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { ToolDef } from "./server.js";

export function loadTools(): ToolDef[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const manifest = JSON.parse(readFileSync(join(here, "../../mcp-manifest.json"), "utf8"));
  return manifest.tools as ToolDef[];
}
