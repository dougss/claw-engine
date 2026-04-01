import { describe, it, expect, beforeEach } from "vitest";
import { assembleToolPool } from "../../../src/harness/tool-pool.js";
import {
  createQueryEngineConfig,
  TOOL_PROFILE,
} from "../../../src/harness/query-engine-config.js";
import {
  registerTool,
  clearRegistry,
} from "../../../src/harness/tools/tool-registry.js";
import type { ToolHandler } from "../../../src/harness/tools/tool-types.js";

function makeDummyTool(name: string): ToolHandler {
  return {
    name,
    description: `${name} tool`,
    inputSchema: {},
    execute: async () => ({ output: "ok", isError: false }),
  };
}

describe("ToolPool", () => {
  beforeEach(() => {
    clearRegistry();
    for (const name of [
      "bash",
      "read_file",
      "write_file",
      "edit_file",
      "glob",
      "grep",
      "ask_user",
    ]) {
      registerTool(makeDummyTool(name));
    }
  });

  it("full profile includes all 7 builtins", () => {
    const config = createQueryEngineConfig({ toolProfile: TOOL_PROFILE.full });
    const pool = assembleToolPool({ config });
    expect(pool.tools.length).toBe(7);
    expect(pool.toolNames).toContain("bash");
    expect(pool.toolNames).toContain("write_file");
  });

  it("simple profile excludes bash, write_file, edit_file", () => {
    const config = createQueryEngineConfig({
      toolProfile: TOOL_PROFILE.simple,
    });
    const pool = assembleToolPool({ config });
    expect(pool.toolNames).not.toContain("bash");
    expect(pool.toolNames).not.toContain("write_file");
    expect(pool.toolNames).not.toContain("edit_file");
    expect(pool.toolNames).toContain("read_file");
    expect(pool.toolNames).toContain("glob");
    expect(pool.toolNames).toContain("grep");
    expect(pool.toolNames).toContain("ask_user");
  });

  it("readonly profile includes only read_file, glob, grep", () => {
    const config = createQueryEngineConfig({
      toolProfile: TOOL_PROFILE.readonly,
    });
    const pool = assembleToolPool({ config });
    expect(pool.toolNames).toEqual(
      expect.arrayContaining(["read_file", "glob", "grep"]),
    );
    expect(pool.toolNames).toHaveLength(3);
  });

  it("custom profile uses allowedTools list", () => {
    const config = createQueryEngineConfig({
      toolProfile: TOOL_PROFILE.custom,
      allowedTools: ["read_file", "grep"],
    });
    const pool = assembleToolPool({ config });
    expect(pool.toolNames).toEqual(
      expect.arrayContaining(["read_file", "grep"]),
    );
    expect(pool.toolNames).toHaveLength(2);
  });

  it("getDefinitions returns ToolDefinition array", () => {
    const config = createQueryEngineConfig({
      toolProfile: TOOL_PROFILE.readonly,
    });
    const pool = assembleToolPool({ config });
    const defs = pool.getDefinitions();
    expect(defs[0]).toHaveProperty("name");
    expect(defs[0]).toHaveProperty("description");
    expect(defs[0]).toHaveProperty("inputSchema");
  });

  it("getHandler returns handler by name", () => {
    const config = createQueryEngineConfig({ toolProfile: TOOL_PROFILE.full });
    const pool = assembleToolPool({ config });
    const handler = pool.getHandler("bash");
    expect(handler).not.toBeNull();
    expect(handler?.name).toBe("bash");
  });

  it("getHandler returns null for tool not in profile", () => {
    const config = createQueryEngineConfig({
      toolProfile: TOOL_PROFILE.readonly,
    });
    const pool = assembleToolPool({ config });
    expect(pool.getHandler("bash")).toBeNull();
  });
});

