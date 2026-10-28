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
  return manifest.tools as ToolDef[];
}
