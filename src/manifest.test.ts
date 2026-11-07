import { describe, it, expect } from "vitest";
import { loadTools, findProjectFile } from "./load-tools.js";

describe("mcp-manifest", () => {
  it("exposes six normalized codex_ tools with required fields", () => {
    const tools = loadTools();
    expect(tools).toHaveLength(6);
    expect(new Set(tools.map(tool => tool.name)).size).toBe(6);
    for (const tool of tools) {
      expect(tool.name).toMatch(/^codex_/);
      expect(typeof tool.description).toBe("string");
      expect(tool.description.trim().length).toBeGreaterThan(0);
      expect(tool.inputSchema).toBeTruthy();
      expect(Array.isArray(tool.inputSchema)).toBe(false);
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  it("preserves each source schema through runtime normalization", () => {
    const manifest = JSON.parse(findProjectFile("mcp-manifest.json"));
    const tools = loadTools();
    expect(tools).toHaveLength(manifest.tools.length);
    for (const [index, tool] of tools.entries()) {
      const raw = manifest.tools[index];
      const expectedSchema = raw.inputSchema ?? raw.input_schema;
      expect(expectedSchema).toBeDefined();
      expect(tool.name).toBe(raw.name);
      expect(tool.description).toBe(raw.description);
      expect(tool.inputSchema).toEqual(expectedSchema);
      expect(tool).not.toHaveProperty("input_schema");
      if (raw.annotations) {
        expect(tool.annotations).toEqual(raw.annotations);
      }
    }
  });
});
