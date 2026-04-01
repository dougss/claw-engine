import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ToolHandler } from "../tool-types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

export const writeFileTool: ToolHandler = {
  name: "write_file",
  description: "Write a text file (create/overwrite)",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      contents: { type: "string" },
    },
    required: ["path", "contents"],
  },
  async execute(input) {
    if (
      !isRecord(input) ||
      typeof input.path !== "string" ||
      typeof input.contents !== "string"
    ) {
      return {
        output: "invalid input: expected { path: string, contents: string }",
        isError: true,
      };
    }

    const filePath = input.path;
    const dir = path.dirname(filePath);

    try {
      await mkdir(dir, { recursive: true });
      await writeFile(filePath, input.contents, "utf8");
      return { output: "ok", isError: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { output: message, isError: true };
    }
  },
};
