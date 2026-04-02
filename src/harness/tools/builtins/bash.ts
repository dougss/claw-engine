import { spawn } from "node:child_process";
import type { ToolHandler } from "../tool-types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

export const bashTool: ToolHandler = {
  name: "bash",
  description:
    'Execute a shell command. Example: {"command": "npx tsc --noEmit"} or {"command": "ls src/", "cwd": "/some/path"}',
  inputSchema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "Shell command to run, e.g. npx tsc --noEmit",
      },
      cwd: {
        type: "string",
        description: "Working directory (defaults to workspace root)",
      },
      timeoutMs: {
        type: "number",
        description: "Timeout in milliseconds (default 30000)",
      },
      background: {
        type: "boolean",
        description: "Run in background without waiting (default false)",
      },
    },
    required: ["command"],
  },
  async execute(input, context) {
    if (!isRecord(input) || typeof input.command !== "string") {
      return {
        output: "invalid input: expected { command: string }",
        isError: true,
      };
    }

    const command = input.command;
    const cwd =
      typeof input.cwd === "string" && input.cwd.length > 0
        ? input.cwd
        : context.workspacePath;
    const timeoutMs =
      typeof input.timeoutMs === "number" && Number.isFinite(input.timeoutMs)
        ? Math.max(0, Math.floor(input.timeoutMs))
        : 30000;
    const background = input.background === true;

    if (background) {
      try {
        const child = spawn(command, {
          cwd,
          shell: true,
          detached: true,
          stdio: "ignore",
        });
        const pid = child.pid ?? null;
        child.unref();
        return {
          output: JSON.stringify({ pid, status: "backgrounded" }),
          isError: false,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { output: message, isError: true };
      }
    }

    return await new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let didTimeout = false;

      const child = spawn(command, { cwd, shell: true });

      const timeout =
        timeoutMs > 0
          ? setTimeout(() => {
              didTimeout = true;
              child.kill("SIGKILL");
            }, timeoutMs)
          : null;

      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("error", (error) => {
        if (timeout) clearTimeout(timeout);
        resolve({ output: error.message, isError: true });
      });

      child.on("close", (code, signal) => {
        if (timeout) clearTimeout(timeout);
        if (didTimeout) {
          resolve({
            output: `command timed out after ${timeoutMs}ms`,
            isError: true,
          });
          return;
        }

        const combined = `${stdout}${stderr}`.trimEnd();
        if (code === 0) {
          resolve({ output: combined, isError: false });
          return;
        }

        const suffix = signal ? ` (signal ${signal})` : "";
        resolve({
          output:
            combined.length > 0
              ? combined
              : `command failed with code ${code}${suffix}`,
          isError: true,
        });
      });
    });
  },
};
