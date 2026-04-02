import { runClaudePipe } from "../../../integrations/claude-p/claude-pipe.js";
import type { ToolHandler } from "../tool-types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

const MAX_CONCURRENT_AGENTS = 3;

/**
 * Tracks running agents (both background and foreground): taskId → Promise<string>.
 * Module-level so the limit is shared across all tool invocations.
 */
const backgroundAgents = new Map<string, Promise<string>>();

/** Monotonic counter appended to Date.now() to guarantee unique IDs within a ms. */
let _agentSeq = 0;
function makeAgentId(): string {
  return `agent-${Date.now()}-${++_agentSeq}`;
}

export const spawnAgentTool: ToolHandler = {
  name: "spawn_agent",
  description:
    "Spawn a sub-agent via claude -p. Foreground (default) blocks and returns full output. Background spawns without waiting and returns a taskId.",
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
      worktree: {
        type: "string",
        description:
          "Optional worktree path override (future: real worktree creation). Currently treated as workspacePath override.",
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

    if (backgroundAgents.size >= MAX_CONCURRENT_AGENTS) {
      return {
        output: `max concurrent sub-agents (${MAX_CONCURRENT_AGENTS}) reached`,
        isError: true,
      };
    }

    const prompt = input.prompt;

    // worktree param is treated as a workspacePath override for now
    const worktreeOverride =
      typeof input.worktree === "string" && input.worktree.length > 0
        ? input.worktree
        : undefined;

    const workspacePath =
      worktreeOverride ??
      (typeof input.workspacePath === "string" && input.workspacePath.length > 0
        ? input.workspacePath
        : context.workspacePath);

    const maxTurns =
      typeof input.maxTurns === "number" && Number.isFinite(input.maxTurns)
        ? Math.max(1, Math.floor(input.maxTurns))
        : undefined;

    const background = input.background === true;
    const claudeBin = process.env.CLAUDE_BIN ?? "claude";

    if (background) {
      const taskId = makeAgentId();

      const promise = (async (): Promise<string> => {
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
        return output;
      })().finally(() => {
        backgroundAgents.delete(taskId);
      });

      backgroundAgents.set(taskId, promise);

      return {
        output: JSON.stringify({ taskId, status: "backgrounded" }),
        isError: false,
      };
    }

    // ── Foreground: use runClaudePipe and accumulate text_delta events ──────────
    const taskId = makeAgentId();
    const placeholder = Promise.resolve("");
    backgroundAgents.set(taskId, placeholder);

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
      backgroundAgents.delete(taskId);
    }
  },
};
