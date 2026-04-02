import type { Message, ToolDefinition } from "../../types.js";
import type { HarnessEvent } from "../events.js";
import type { ModelAdapter } from "./adapter-types.js";
import { runOpencodePipe } from "../../integrations/opencode/opencode-pipe.js";

interface OpencodePipeAdapterOptions {
  name: string;
  /** Model in OpenCode format: provider/model (e.g. "anthropic/claude-sonnet-4-5"). */
  model?: string;
  /** Path to opencode binary. Defaults to "opencode" (assumes it's on PATH). */
  opencodeBin?: string;
  /** Working directory for the subprocess. Set by session manager before use. */
  workspacePath?: string;
  /** Max tokens for budget tracking. Default 200k. */
  maxContext?: number;
}

/**
 * Delegate Mode adapter: hands off the full task to `opencode run`.
 *
 * OpenCode manages its own tools. The `tools` parameter from chat() is
 * intentionally ignored — this adapter relies on OpenCode's internal tool
 * configuration rather than the harness built-ins.
 */
export function createOpencodePipeAdapter({
  name,
  model,
  opencodeBin,
  workspacePath,
  maxContext = 200_000,
}: OpencodePipeAdapterOptions): ModelAdapter {
  return {
    name,
    provider: "opencode",
    maxContext,
    supportsToolUse: true,
    supportsStreaming: true,
    // Approximate cost — depends on the model configured in OpenCode
    costPerInputToken: 3 / 1_000_000,
    costPerOutputToken: 15 / 1_000_000,

    async *chat(
      messages: Message[],
      _tools: ToolDefinition[], // ignored — opencode run uses its own tools
    ): AsyncIterable<HarnessEvent> {
      const userMsg = [...messages].reverse().find((m) => m.role === "user");
      if (!userMsg) {
        yield { type: "session_end", reason: "error" };
        return;
      }

      yield* runOpencodePipe({
        prompt: userMsg.content,
        model,
        opencodeBin,
        workspacePath,
      });
    },
  };
}
