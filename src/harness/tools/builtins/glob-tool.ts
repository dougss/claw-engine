import fg from "fast-glob";
import type { ToolHandler } from "../tool-types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

export const globTool: ToolHandler = {
  name: "glob",
  description: "Find files by glob pattern",
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string" },
      cwd: { type: "string" },
    },
    required: ["pattern"],
  },
  async execute(input, context) {
    if (!isRecord(input) || typeof input.pattern !== "string") {
      return {
        output: "invalid input: expected { pattern: string }",
        isError: true,
      };
    }

    const cwd =
      typeof input.cwd === "string" && input.cwd.length > 0
        ? input.cwd
        : context.workspacePath;

    try {
      const matches = await fg(input.pattern, {
        cwd,
        dot: true,
        onlyFiles: true,
      });
      return { output: JSON.stringify(matches), isError: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { output: message, isError: true };
    }
  },
};
