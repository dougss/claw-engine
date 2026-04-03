import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { rgPath } from "@vscode/ripgrep";
import type { ToolHandler } from "../tool-types.js";

const execFileAsync = promisify(execFile);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

export const grepTool: ToolHandler = {
  name: "grep",
  isConcurrencySafe: true,
  description: "Search text using ripgrep",
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string" },
      path: { type: "string" },
      glob: { type: "string" },
      context: { type: "number" },
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

    const searchPath =
      typeof input.path === "string" && input.path.length > 0
        ? input.path
        : context.workspacePath;

    const args: string[] = [];

    if (typeof input.glob === "string" && input.glob.length > 0) {
      args.push("--glob", input.glob);
    }

    if (typeof input.context === "number" && Number.isFinite(input.context)) {
      const c = Math.max(0, Math.floor(input.context));
      if (c > 0) args.push("-C", String(c));
    }

    args.push(input.pattern, searchPath);

    try {
      const { stdout, stderr } = await execFileAsync(rgPath, args, {
        maxBuffer: 10 * 1024 * 1024,
      });
      return { output: `${stdout}${stderr}`.trimEnd(), isError: false };
    } catch (error) {
      const anyError = error as unknown as {
        stdout?: string;
        stderr?: string;
        code?: number;
        message?: string;
      };

      if (anyError.code === 1) {
        const out =
          `${anyError.stdout ?? ""}${anyError.stderr ?? ""}`.trimEnd();
        return { output: out, isError: false };
      }

      const out = `${anyError.stdout ?? ""}${anyError.stderr ?? ""}`.trimEnd();
      const message = anyError.message ?? "rg failed";
      return { output: out.length > 0 ? out : message, isError: true };
    }
  },
};
