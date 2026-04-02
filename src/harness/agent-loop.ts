import type {
  Message,
  ToolCallRecord,
  ToolDefinition,
  ToolResult,
} from "../types.js";
import type { HarnessEvent } from "./events.js";
import type { ModelAdapter } from "./model-adapters/adapter-types.js";
import { getTool, isMcpTool } from "./tools/tool-registry.js";
import type { ToolContext, ToolHandler } from "./tools/tool-types.js";
import {
  DEFAULT_PERMISSION_RULES,
  evaluatePermission,
  type PermissionRule,
} from "./permissions.js";

const SUMMARY_PROMPT =
  "You are approaching the context limit. Please summarize what you have accomplished so far and what still needs to be done, so work can resume seamlessly in a new session. Be concise.";

export interface RunAgentLoopInput {
  adapter: ModelAdapter;
  systemPrompt: string;
  userPrompt: string;
  messages?: Message[];
  tools: ToolDefinition[];
  maxIterations: number;
  tokenBudget: number;
  workspacePath: string;
  toolHandlers?: Map<string, ToolHandler>;
  sessionId?: string;
  /** Percent of context window at which a checkpoint is triggered. Default: 85. */
  checkpointThresholdPercent?: number;
  permissionRules?: PermissionRule[];
  mcpCallTool?: (name: string, input: unknown) => Promise<ToolResult>;
}

function createToolMessage({
  toolUseId,
  toolName,
  output,
}: {
  toolUseId: string;
  toolName: string;
  output: string;
}): Message {
  return {
    role: "tool",
    content: output,
    toolUseId,
    toolName,
  };
}

function createAssistantMessage(content: string): Message {
  return { role: "assistant", content };
}

function getToolHandler({
  name,
  toolHandlers,
}: {
  name: string;
  toolHandlers?: Map<string, ToolHandler>;
}): ToolHandler | null {
  if (toolHandlers) return toolHandlers.get(name) ?? null;
  return getTool(name);
}

const DEFAULT_MAX_RESULT_SIZE: Record<string, number> = {
  bash: 100000,
  grep: 50000,
  glob: 20000,
};
const FALLBACK_MAX_RESULT_SIZE = 50000;

function truncateOutput(output: string, maxChars: number): string {
  if (output.length <= maxChars) return output;
  return (
    output.slice(0, maxChars) + `... [output truncated at ${maxChars} chars]`
  );
}

async function executeTool({
  handler,
  input,
  context,
}: {
  handler: ToolHandler;
  input: unknown;
  context: ToolContext;
}): Promise<ToolResult> {
  const result = await handler.execute(input, context);
  const maxChars =
    handler.maxResultSizeChars ??
    DEFAULT_MAX_RESULT_SIZE[handler.name] ??
    FALLBACK_MAX_RESULT_SIZE;
  return { ...result, output: truncateOutput(result.output, maxChars) };
}

export async function* runAgentLoop({
  adapter,
  systemPrompt,
  userPrompt,
  messages: providedMessages,
  tools,
  maxIterations,
  tokenBudget: _tokenBudget,
  workspacePath,
  toolHandlers,
  sessionId = "test-session",
  checkpointThresholdPercent = 85,
  permissionRules = DEFAULT_PERMISSION_RULES,
  mcpCallTool,
}: RunAgentLoopInput): AsyncGenerator<HarnessEvent> {
  const messages: Message[] =
    providedMessages ??
    ([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ] as Message[]);

  let everWrote = false; // tracks if any write/edit tool was ever called

  for (let i = 0; i < maxIterations; i++) {
    let sawToolUse = false;
    let assistantText = "";
    let highestPercent = 0;

    // Collect tool calls and their results separately so we can push them to
    // messages in the correct OpenAI order: [assistant (text+toolCalls), tool, tool, ...]
    const turnToolCalls: ToolCallRecord[] = [];
    const turnToolResults: Message[] = [];

    for await (const event of adapter.chat(messages, tools)) {
      yield event;

      if (event.type === "text_delta") {
        assistantText += event.text;
      }

      if (event.type === "token_update") {
        if (event.percent > highestPercent) highestPercent = event.percent;
      }

      if (event.type !== "tool_use") continue;

      sawToolUse = true;
      if (["write_file", "edit_file", "bash"].includes(event.name)) {
        everWrote = true;
      }

      // Record the actual tool call with its real arguments for history
      turnToolCalls.push({
        id: event.id,
        name: event.name,
        arguments: JSON.stringify(event.input ?? {}),
      });

      const handler = getToolHandler({ name: event.name, toolHandlers });

      const permission = evaluatePermission({
        tool: event.name,
        input: event.input,
        workspacePath,
        rules: permissionRules,
      });

      if (permission.action !== "allow") {
        yield {
          type: "permission_denied",
          tool: event.name,
          reason: permission.reason,
        };

        const denied = `Permission denied for tool "${event.name}": ${permission.reason}`;
        yield {
          type: "tool_result",
          id: event.id,
          output: denied,
          isError: true,
        };
        turnToolResults.push(
          createToolMessage({
            toolUseId: event.id,
            toolName: event.name,
            output: denied,
          }),
        );
        continue;
      }

      if (!handler) {
        if (mcpCallTool && isMcpTool(event.name)) {
          const result = await mcpCallTool(event.name, event.input);
          yield {
            type: "tool_result",
            id: event.id,
            output: result.output,
            isError: result.isError,
          };
          turnToolResults.push(
            createToolMessage({
              toolUseId: event.id,
              toolName: event.name,
              output: result.output,
            }),
          );
          continue;
        }

        const notFound = `Tool not found: ${event.name}`;
        yield {
          type: "tool_result",
          id: event.id,
          output: notFound,
          isError: true,
        };
        turnToolResults.push(
          createToolMessage({
            toolUseId: event.id,
            toolName: event.name,
            output: notFound,
          }),
        );
        continue;
      }

      const result = await executeTool({
        handler,
        input: event.input,
        context: { workspacePath, sessionId },
      });

      yield {
        type: "tool_result",
        id: event.id,
        output: result.output,
        isError: result.isError,
      };
      turnToolResults.push(
        createToolMessage({
          toolUseId: event.id,
          toolName: event.name,
          output: result.output,
        }),
      );
    }

    // Push messages in correct OpenAI order:
    // 1. assistant message with text AND tool_calls (with real arguments)
    // 2. one tool result message per call
    if (assistantText || turnToolCalls.length > 0) {
      messages.push({
        role: "assistant",
        content: assistantText,
        ...(turnToolCalls.length > 0 ? { toolCalls: turnToolCalls } : {}),
      });
    }
    for (const toolMsg of turnToolResults) {
      messages.push(toolMsg);
    }

    // Check checkpoint threshold before deciding to continue
    if (highestPercent >= checkpointThresholdPercent) {
      // Inject a summary request so the session can be resumed meaningfully
      messages.push({ role: "user", content: SUMMARY_PROMPT });
      for await (const event of adapter.chat(messages, [])) {
        yield event;
      }
      yield { type: "checkpoint", reason: "token_limit" };
      yield { type: "session_end", reason: "checkpoint" };
      return;
    }

    if (!sawToolUse) {
      // If the model hasn't written anything yet, it's not done — nudge it.
      // Accept completion only after at least one write/edit/bash tool was used.
      if (!everWrote && i < maxIterations - 1) {
        const nudgesSoFar = messages.filter(
          (m) =>
            m.role === "user" &&
            typeof m.content === "string" &&
            m.content.startsWith("Stop explaining"),
        ).length;
        if (nudgesSoFar < 3) {
          const nudge =
            assistantText.trim().length > 0
              ? "Stop explaining. Use the tools now to implement what you described. Do not write prose — call a tool."
              : "You must use tools to implement the task. Call write_file or edit_file to make changes. Do not return without calling a tool.";
          messages.push({ role: "user", content: nudge });
          continue;
        }
      }
      yield { type: "session_end", reason: "completed" };
      return;
    }
  }

  yield { type: "session_end", reason: "max_iterations" };
}
