import type { Message, ToolDefinition } from "../../types.js";
import type { HarnessEvent } from "../events.js";
import type { ModelAdapter } from "./adapter-types.js";
import { runClaudePipe } from "../../integrations/claude-p/claude-pipe.js";

interface ClaudePipeAdapterOptions {
  name: string;
  /** Claude model to pass via --model flag. Defaults to the CLI's configured model. */
  model?: string;
  /**
   * Comma-separated tool allow-list for --allowedTools.
   * Defaults to all tools (no flag sent).
   */
  allowedTools?: string[];
  /** Path to claude binary. Defaults to "claude" (assumes it's on PATH). */
  claudeBin?: string;
  /** Working directory for the subprocess. Set by session manager before use. */
  workspacePath?: string;
  /** Max tokens for budget tracking. Default 200k (Claude Sonnet context). */
  maxContext?: number;
}

/**
 * Delegate Mode adapter: hands off the full task to `claude -p`.
 *
 * Claude Code manages its own tools (bash, read, write, edit, …). The
 * `tools` parameter from chat() is intentionally ignored — this adapter
 * does NOT inject the harness built-ins; it relies on the subprocess having
 * access to the necessary tools via its own configuration.
 *
 * Use this adapter when you want full Claude Code autonomy in an isolated
 * git worktree rather than the harness-managed Engine Mode.
 */
export function createClaudePipeAdapter({
  name,
  model,
  allowedTools,
  claudeBin,
  workspacePath,
  maxContext = 200_000,
}: ClaudePipeAdapterOptions): ModelAdapter {
  return {
    name,
    provider: "anthropic",
    maxContext,
    supportsToolUse: true,
    supportsStreaming: true,
    // Claude Sonnet 4.x pricing (approximate, per token)
    costPerInputToken: 3 / 1_000_000,
    costPerOutputToken: 15 / 1_000_000,

    async *chat(
      messages: Message[],
      _tools: ToolDefinition[], // ignored — claude -p uses its own tools
    ): AsyncIterable<HarnessEvent> {
      // Extract last user message as the prompt
      const userMsg = [...messages].reverse().find((m) => m.role === "user");
      if (!userMsg) {
        yield { type: "session_end", reason: "error" };
        return;
      }

      // Extract first system message as system prompt override
      const systemMsg = messages.find((m) => m.role === "system");

      yield* runClaudePipe({
        prompt: userMsg.content,
        systemPrompt: systemMsg?.content,
        model,
        allowedTools,
        claudeBin,
        workspacePath,
      });
    },
  };
}
