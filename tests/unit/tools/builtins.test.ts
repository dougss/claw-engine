import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { ToolContext } from "../../../src/harness/tools/tool-types.js";
import { bashTool } from "../../../src/harness/tools/builtins/bash.js";
import { readFileTool } from "../../../src/harness/tools/builtins/read-file.js";
import { writeFileTool } from "../../../src/harness/tools/builtins/write-file.js";
import { editFileTool } from "../../../src/harness/tools/builtins/edit-file.js";
import { globTool } from "../../../src/harness/tools/builtins/glob-tool.js";
import { grepTool } from "../../../src/harness/tools/builtins/grep-tool.js";
import { askUserTool } from "../../../src/harness/tools/builtins/ask-user.js";

async function withTempDir<T>(run: (dir: string) => Promise<T>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "claw-tools-"));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function createContext(workspacePath: string): ToolContext {
  return { workspacePath, sessionId: "test-session" };
}

describe("built-in tools", () => {
  it("exports all handlers", () => {
    expect(bashTool.name).toBe("bash");
    expect(readFileTool.name).toBe("read_file");
    expect(writeFileTool.name).toBe("write_file");
    expect(editFileTool.name).toBe("edit_file");
    expect(globTool.name).toBe("glob");
    expect(grepTool.name).toBe("grep");
    expect(askUserTool.name).toBe("ask_user");
  });

  it("read/write/edit roundtrip on a temp file", async () => {
    await withTempDir(async (dir) => {
      const ctx = createContext(dir);
      const filePath = path.join(dir, "a.txt");

      const write = await writeFileTool.execute(
        { path: filePath, contents: "hello\nworld\nworld" },
        ctx,
      );
      expect(write.isError).toBe(false);

      const read1 = await readFileTool.execute(
        { path: filePath, offset: 0, limit: 2 },
        ctx,
      );
      expect(read1.isError).toBe(false);
      expect(read1.output).toBe("hello\nworld");

      const edit = await editFileTool.execute(
        { path: filePath, old_string: "hello", new_string: "hi" },
        ctx,
      );
      expect(edit.isError).toBe(false);

      const read2 = await readFileTool.execute({ path: filePath }, ctx);
      expect(read2.isError).toBe(false);
      expect(read2.output.startsWith("hi\n")).toBe(true);
    });
  });

  it("edit_file errors on multiple matches", async () => {
    await withTempDir(async (dir) => {
      const ctx = createContext(dir);
      const filePath = path.join(dir, "b.txt");

      await writeFileTool.execute(
        { path: filePath, contents: "x\nworld\nworld\n" },
        ctx,
      );

      const edit = await editFileTool.execute(
        { path: filePath, old_string: "world", new_string: "planet" },
        ctx,
      );
      expect(edit.isError).toBe(true);
      expect(edit.output).toMatch(/multiple/i);
    });
  });

  it("glob finds files", async () => {
    await withTempDir(async (dir) => {
      const ctx = createContext(dir);
      await writeFileTool.execute(
        { path: path.join(dir, "x.ts"), contents: "a" },
        ctx,
      );
      await writeFileTool.execute(
        { path: path.join(dir, "y.txt"), contents: "b" },
        ctx,
      );

      const res = await globTool.execute({ pattern: "**/*.ts" }, ctx);
      expect(res.isError).toBe(false);
      const files = JSON.parse(res.output) as string[];
      expect(files.some((f) => f.endsWith("x.ts"))).toBe(true);
    });
  });

  it("grep returns matches", async () => {
    await withTempDir(async (dir) => {
      const ctx = createContext(dir);
      const filePath = path.join(dir, "grep.txt");
      await writeFileTool.execute(
        { path: filePath, contents: "alpha\nbeta\ngamma\n" },
        ctx,
      );

      const res = await grepTool.execute({ pattern: "beta", path: dir }, ctx);
      expect(res.isError).toBe(false);
      expect(res.output).toMatch(/beta/);
    });
  });

  it("bash runs safely", async () => {
    await withTempDir(async (dir) => {
      const ctx = createContext(dir);

      const res = await bashTool.execute(
        { command: 'node -e "console.log(123)"', cwd: dir },
        ctx,
      );
      expect(res.isError).toBe(false);
      expect(res.output.trim()).toBe("123");
    });
  });

  it("ask_user returns pending token if no callback", async () => {
    await withTempDir(async (dir) => {
      const ctx = createContext(dir);
      const res = await askUserTool.execute({ question: "ok?" }, ctx);
      expect(res.isError).toBe(false);
      expect(res.output).toMatch(/pending_user_input/);
    });
  });
});
