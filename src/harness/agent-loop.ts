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
import { classifyError } from "../core/error-classifier.js";

const FATAL_ERROR_CATEGORIES = new Set(["auth"]);
const MAX_PARALLEL_TOOLS = 5;

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
  workItemId?: string;
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
  read_file: Infinity, // No limit for read_file - users control with offset/limit params
};
const FALLBACK_MAX_RESULT_SIZE = 50000;

function truncateOutput(output: string, maxChars: number): string {
  if (output.length <= maxChars || maxChars === Infinity) return output;
  return (
    output.slice(0, maxChars) +
    `\n... [output truncated at ${maxChars} chars. Use more specific commands or add offset/limit params]`
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

type PendingBuiltin = {
  id: string;
  name: string;
  kind: "builtin";
  input: unknown;
  handler: ToolHandler;
};
type PendingMcp = { id: string; name: string; kind: "mcp"; input: unknown };
type PendingResolved = {
  id: string;
  name: string;
  kind: "resolved";
  output: string;
  isError: boolean;
};
type PendingToolCall = PendingBuiltin | PendingMcp | PendingResolved;

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
  workItemId,
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

    // Tool calls are collected during streaming, then executed in Phase 2.
    // Order: [assistant (text+toolCalls), tool, tool, ...] (OpenAI wire format)
    const turnToolCalls: ToolCallRecord[] = [];
    const turnToolResults: Message[] = [];

    // Phase 1: COLLECT — stream events, defer tool execution
    const pendingToolCalls: PendingToolCall[] = [];

    try {
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
          pendingToolCalls.push({
            id: event.id,
            name: event.name,
            kind: "resolved",
            output: `Permission denied for tool "${event.name}": ${permission.reason}`,
            isError: true,
          });
          continue;
        }

        if (!handler) {
          if (mcpCallTool && isMcpTool(event.name)) {
            pendingToolCalls.push({
              id: event.id,
              name: event.name,
              kind: "mcp",
              input: event.input,
            });
          } else {
            pendingToolCalls.push({
              id: event.id,
              name: event.name,
              kind: "resolved",
              output: `Tool not found: ${event.name}`,
              isError: true,
            });
          }
          continue;
        }

        pendingToolCalls.push({
          id: event.id,
          name: event.name,
          kind: "builtin",
          input: event.input,
          handler,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const category = classifyError(msg);
      console.warn(
        `[agent-loop] adapter.chat error — category: ${category}`,
        msg,
      );
      if (FATAL_ERROR_CATEGORIES.has(category)) {
        throw err;
      }
      // retryable (timeout, rate_limit, network) and others: let outer loop retry
      continue;
    }

    // Phase 2: EXECUTE — partition safe/unsafe, execute, yield results in original order
    const resultMap = new Map<string, { output: string; isError: boolean }>();

    const safeBatch = pendingToolCalls.filter(
      (tc): tc is PendingBuiltin =>
        tc.kind === "builtin" && (tc.handler.isConcurrencySafe ?? false),
    );
    const safeIds = new Set(safeBatch.map(tc => tc.id));
    const unsafeBatch = pendingToolCalls.filter(
      (tc) => !safeIds.has(tc.id),
    );

    // Run concurrency-safe tools in parallel, capped at MAX_PARALLEL_TOOLS per chunk
    for (let j = 0; j < safeBatch.length; j += MAX_PARALLEL_TOOLS) {
      const chunk = safeBatch.slice(j, j + MAX_PARALLEL_TOOLS);
      const results = await Promise.allSettled(
        chunk.map(async (tc) => {
          const result = await executeTool({
            handler: tc.handler,
            input: tc.input,
            context: { workspacePath, sessionId, workItemId },
          });
          return { id: tc.id, output: result.output, isError: result.isError };
        })
      );
      
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const tc = chunk[i];
        
        if (result.status === 'fulfilled') {
          resultMap.set(tc.id, { output: result.value.output, isError: result.value.isError });
        } else {
          resultMap.set(tc.id, { 
            output: `Error executing tool: ${result.reason instanceof Error ? result.reason.message : 'Unknown error'}`, 
            isError: true 
          });
        }
      }
    }

    // Run remaining tools sequentially (unsafe builtins, MCP, pre-resolved)
    for (const tc of unsafeBatch) {
      let output: string;
      let isError: boolean;

      if (tc.kind === "resolved") {
        output = tc.output;
        isError = tc.isError;
      } else if (tc.kind === "mcp") {
        if (!mcpCallTool) {
          output = `Error: MCP tool "${tc.name}" called but no mcpCallTool handler provided`;
          isError = true;
        } else {
          const result = await mcpCallTool(tc.name, tc.input);
          output = truncateOutput(result.output, FALLBACK_MAX_RESULT_SIZE);
          isError = result.isError;
        }
      } else {
        // builtin, not concurrency-safe
        const result = await executeTool({
          handler: tc.handler,
          input: tc.input,
          context: { workspacePath, sessionId, workItemId },
        });
        output = result.output;
        isError = result.isError;
      }

      resultMap.set(tc.id, { output, isError });
    }

    // Yield tool_result events and build turnToolResults in original tool_use order
    for (const tc of pendingToolCalls) {
      const result = resultMap.get(tc.id);
      if (!result) {
        yield {
          type: "tool_result",
          id: tc.id,
          output: `Error: Tool result not found for tool ${tc.id}`,
          isError: true,
        };
        turnToolResults.push(
          createToolMessage({
            toolUseId: tc.id,
            toolName: tc.name,
            output: `Error: Tool result not found for tool ${tc.id}`,
          }),
        );
        continue;
      }
      yield {
        type: "tool_result",
        id: tc.id,
        output: result.output,
        isError: result.isError,
      };
      turnToolResults.push(
        createToolMessage({
          toolUseId: tc.id,
          toolName: tc.name,
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
