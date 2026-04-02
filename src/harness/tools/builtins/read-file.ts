import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ToolHandler } from "../tool-types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

export const readFileTool: ToolHandler = {
  name: "read_file",
  description:
    'Read a text file. Example: {"path": "src/foo.ts"} or {"path": "src/foo.ts", "offset": 10, "limit": 50}',
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "File path relative to workspace root, e.g. src/foo.ts",
      },
      offset: {
        type: "number",
        description: "Line number to start reading from (0-based)",
      },
      limit: { type: "number", description: "Maximum number of lines to read" },
    },
    required: ["path"],
  },
  async execute(input, context) {
    if (!isRecord(input) || typeof input.path !== "string") {
      return {
        output: "invalid input: expected { path: string }",
        isError: true,
      };
    }

    const filePath = path.isAbsolute(input.path)
      ? input.path
      : path.join(context.workspacePath, input.path);
    const offset =
      typeof input.offset === "number" && Number.isFinite(input.offset)
        ? Math.max(0, Math.floor(input.offset))
        : 0;
    const limit =
      typeof input.limit === "number" && Number.isFinite(input.limit)
        ? Math.max(0, Math.floor(input.limit))
        : null;

    try {
      const contents = await readFile(filePath, "utf8");
      const lines = contents.split("\n");
      const sliced = lines.slice(
        offset,
        limit === null ? undefined : offset + limit,
      );
      return { output: sliced.join("\n"), isError: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { output: message, isError: true };
    }
  },
};
