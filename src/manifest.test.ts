import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("mcp-manifest", () => {
  it("exposes six codex_ tools with required fields", () => {
    const manifest = JSON.parse(readFileSync("mcp-manifest.json", "utf8"));
    expect(manifest.tools).toHaveLength(6);
    for (const tool of manifest.tools) {
      expect(tool.name).toMatch(/^codex_/);
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema.type).toBe("object");
    }
  });
});
