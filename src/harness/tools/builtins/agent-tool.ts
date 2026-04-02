import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { runClaudePipe } from "../../../integrations/claude-p/claude-pipe.js";
import type { ToolHandler } from "../tool-types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

const MAX_CONCURRENT_AGENTS = 3;
const activeAgents = new Set<string>();

export const spawnAgentTool: ToolHandler = {
  name: "spawn_agent",
  description:
    "Spawn a sub-agent via claude -p. Foreground (default) blocks and returns full output. Background spawns detached and returns an agent ID.",
  inputSchema: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "The prompt/task for the sub-agent",
      },
      workspacePath: {
        type: "string",
        description:
          "Working directory for the agent (defaults to current workspace)",
      },
      maxTurns: {
        type: "number",
        description: "Maximum agentic turns (passed as --max-turns)",
      },
      background: {
        type: "boolean",
        description:
          "Run in background without waiting for result (default false)",
      },
    },
    required: ["prompt"],
  },
  async execute(input, context) {
    if (!isRecord(input) || typeof input.prompt !== "string") {
      return {
        output: "invalid input: expected { prompt: string }",
        isError: true,
      };
    }

    if (activeAgents.size >= MAX_CONCURRENT_AGENTS) {
      return {
        output: `max concurrent agents reached (${MAX_CONCURRENT_AGENTS}). Wait for an agent to finish.`,
        isError: true,
      };
    }

    const prompt = input.prompt;
    const workspacePath =
      typeof input.workspacePath === "string" && input.workspacePath.length > 0
        ? input.workspacePath
        : context.workspacePath;
    const maxTurns =
      typeof input.maxTurns === "number" && Number.isFinite(input.maxTurns)
        ? Math.max(1, Math.floor(input.maxTurns))
        : undefined;
    const background = input.background === true;
    const claudeBin = process.env.CLAUDE_BIN ?? "claude";

    if (background) {
      const agentId = randomUUID();
      const args = [
        "-p",
        prompt,
        "--output-format",
        "stream-json",
        "--verbose",
      ];
      if (maxTurns !== undefined) args.push("--max-turns", String(maxTurns));

      try {
        const child = spawn(claudeBin, args, {
          cwd: workspacePath,
          stdio: "ignore",
          detached: true,
        });

        activeAgents.add(agentId);

        const cleanup = () => {
          activeAgents.delete(agentId);
        };

        child.on("close", cleanup);
        child.on("error", cleanup);
        child.unref();

        return {
          output: JSON.stringify({ agentId, status: "backgrounded" }),
          isError: false,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          output: `failed to spawn background agent: ${message}`,
          isError: true,
        };
      }
    }

    // Foreground: use runClaudePipe and accumulate text_delta events
    const agentId = randomUUID();
    activeAgents.add(agentId);

    try {
      let output = "";
      for await (const event of runClaudePipe({
        prompt,
        workspacePath,
        claudeBin,
        maxTurns,
      })) {
        if (event.type === "text_delta") {
          output += event.text;
        }
      }

      return { output: output || "(agent produced no output)", isError: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { output: `agent failed: ${message}`, isError: true };
    } finally {
      activeAgents.delete(agentId);
    }
  },
};
