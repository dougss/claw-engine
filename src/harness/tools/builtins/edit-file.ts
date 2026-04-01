import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ToolHandler } from "../tool-types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function countOccurrences(haystack: string, needle: string) {
  if (needle.length === 0) return 0;
  let count = 0;
  let idx = 0;
  while (true) {
    const next = haystack.indexOf(needle, idx);
    if (next === -1) break;
    count += 1;
    idx = next + needle.length;
  }
  return count;
}

export const editFileTool: ToolHandler = {
  name: "edit_file",
  description: "Replace exactly one occurrence in a file",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      old_string: { type: "string" },
      new_string: { type: "string" },
    },
    required: ["path", "old_string", "new_string"],
  },
  async execute(input, context) {
    if (
      !isRecord(input) ||
      typeof input.path !== "string" ||
      typeof input.old_string !== "string" ||
      typeof input.new_string !== "string"
    ) {
      return {
        output:
          "invalid input: expected { path: string, old_string: string, new_string: string }",
        isError: true,
      };
    }

    if (input.old_string.length === 0) {
      return { output: "old_string must not be empty", isError: true };
    }

    const filePath = path.isAbsolute(input.path)
      ? input.path
      : path.join(context.workspacePath, input.path);

    try {
      const contents = await readFile(filePath, "utf8");
      const occurrences = countOccurrences(contents, input.old_string);

      if (occurrences === 0) {
        return { output: "old_string not found", isError: true };
      }

      if (occurrences > 1) {
        return {
          output: "old_string matched multiple occurrences",
          isError: true,
        };
      }

      const next = contents.replace(input.old_string, input.new_string);
      await writeFile(filePath, next, "utf8");
      return { output: "ok", isError: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { output: message, isError: true };
    }
  },
};
