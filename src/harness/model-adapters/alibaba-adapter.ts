import type { Message, ToolCallRecord, ToolDefinition } from "../../types.js";
import type { HarnessEvent } from "../events.js";
import type { ModelAdapter } from "./adapter-types.js";

interface AlibabaAdapterOptions {
  name: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  maxContext?: number;
  maxOutputTokens?: number;
  costPerInputToken?: number;
  costPerOutputToken?: number;
}

// OpenAI-compatible message types
type OAIMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: OAIToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string };

interface OAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OAITool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

function toOAIMessages(messages: Message[]): OAIMessage[] {
  const result: OAIMessage[] = [];
  for (const msg of messages) {
    if (msg.role === "tool") {
      // OpenAI requires an assistant tool_calls message immediately before each
      // tool result. The agent loop now stores assistant messages with real
      // toolCalls. Only fall back to a synthetic placeholder if missing.
      const prev = result[result.length - 1];
      const prevHasCall =
        prev?.role === "assistant" &&
        (
          prev as { role: "assistant"; tool_calls?: OAIToolCall[] }
        ).tool_calls?.some((tc) => tc.id === msg.toolUseId);
      if (!prevHasCall) {
        result.push({
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: msg.toolUseId ?? "unknown",
              type: "function",
              function: { name: msg.toolName ?? "unknown", arguments: "{}" },
            },
          ],
        });
      }
      result.push({
        role: "tool",
        content: msg.content,
        tool_call_id: msg.toolUseId ?? "unknown",
      });
    } else if (
      msg.role === "assistant" &&
      msg.toolCalls &&
      msg.toolCalls.length > 0
    ) {
      // Assistant message with tool calls — use the real recorded arguments
      result.push({
        role: "assistant",
        content: msg.content || null,
        tool_calls: msg.toolCalls.map((tc: ToolCallRecord) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: tc.arguments },
        })),
      });
    } else {
      result.push({
        role: msg.role as "system" | "user" | "assistant",
        content: msg.content,
      });
    }
  }
  return result;
}

function toOAITools(tools: ToolDefinition[]): OAITool[] {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema as Record<string, unknown>,
    },
  }));
}

export function createAlibabaAdapter({
  name,
  model,
  apiKey,
  baseUrl = "https://dashscope.aliyuncs.com/compatible-mode/v1",
  maxContext = 128000,
  maxOutputTokens = 8192,
  costPerInputToken = 0,
  costPerOutputToken = 0,
}: AlibabaAdapterOptions): ModelAdapter {
  return {
    name,
    provider: "alibaba",
    maxContext,
    supportsToolUse: true,
    supportsStreaming: true,
    costPerInputToken,
    costPerOutputToken,

    async *chat(
      messages: Message[],
      tools: ToolDefinition[],
    ): AsyncIterable<HarnessEvent> {
      if (!apiKey) {
        throw new Error(`AlibabaAdapter (${name}) missing apiKey.`);
      }

      const body: Record<string, unknown> = {
        model,
        messages: toOAIMessages(messages),
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: maxOutputTokens,
      };

      if (tools.length > 0) {
        body.tools = toOAITools(tools);
      }

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `AlibabaAdapter (${name}) HTTP ${response.status}: ${errorText}`,
        );
      }

      if (!response.body) {
        throw new Error(`AlibabaAdapter (${name}) response body is null`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // Tool calls accumulated by stream index
      const pendingToolCalls = new Map<
        number,
        { id: string; name: string; arguments: string }
      >();
      let totalTokens = 0;
      // DashScope sends usage in a SEPARATE final chunk after finish_reason.
      // We drain the full stream before emitting token_update so we capture it.
      let finishReason: string | null = null;

      try {
        outer: while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data:")) continue;

            const data = trimmed.slice(5).trim();
            if (data === "[DONE]") break outer;

            let chunk: unknown;
            try {
              chunk = JSON.parse(data);
            } catch {
              continue;
            }

            const c = chunk as {
              choices?: Array<{
                delta?: {
                  content?: string;
                  tool_calls?: Array<{
                    index: number;
                    id?: string;
                    function?: { name?: string; arguments?: string };
                  }>;
                };
                finish_reason?: string | null;
              }>;
              usage?: { prompt_tokens: number; completion_tokens: number };
            };

            // Always capture usage — may arrive in a chunk with empty choices
            if (c.usage) {
              totalTokens = c.usage.prompt_tokens + c.usage.completion_tokens;
            }

            const choice = c.choices?.[0];
            if (!choice) continue;

            const delta = choice.delta;

            if (delta?.content) {
              yield { type: "text_delta", text: delta.content };
            }

            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const existing = pendingToolCalls.get(tc.index) ?? {
                  id: "",
                  name: "",
                  arguments: "",
                };
                if (tc.id) existing.id = tc.id;
                if (tc.function?.name) existing.name = tc.function.name;
                if (tc.function?.arguments)
                  existing.arguments += tc.function.arguments;
                pendingToolCalls.set(tc.index, existing);
              }
            }

            if (choice.finish_reason === "tool_calls") {
              for (const [, tc] of pendingToolCalls) {
                let input: unknown = {};
                try {
                  input = JSON.parse(tc.arguments);
                } catch {
                  input = { raw: tc.arguments };
                }
                yield { type: "tool_use", id: tc.id, name: tc.name, input };
              }
              pendingToolCalls.clear();
              // Don't return yet — keep draining to capture the usage chunk
              finishReason = "tool_calls";
            } else if (choice.finish_reason === "length") {
              // Output token limit hit — yield any pending tool calls (truncated)
              if (pendingToolCalls.size > 0) {
                for (const [, tc] of pendingToolCalls) {
                  let input: unknown = {};
                  try {
                    input = JSON.parse(tc.arguments);
                  } catch {
                    const partial = tc.arguments
                      .replace(/,?\s*"[^"]*"\s*:\s*[^,}]*$/, "")
                      .trimEnd();
                    try {
                      input = JSON.parse(partial + "}");
                    } catch {
                      input = { raw: tc.arguments };
                    }
                  }
                  yield { type: "tool_use", id: tc.id, name: tc.name, input };
                }
                pendingToolCalls.clear();
              }
              finishReason = "length";
            } else if (choice.finish_reason === "stop") {
              finishReason = "stop";
              // Keep draining — usage chunk may follow
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      // Emit token_update after stream is fully drained (captures late usage chunk)
      if (totalTokens > 0) {
        yield {
          type: "token_update",
          used: totalTokens,
          budget: maxContext,
          percent: Math.round((totalTokens / maxContext) * 100),
        };
      }
      // Do NOT yield session_end — session lifecycle is managed by the agent loop.
      void finishReason; // consumed above, suppress unused warning
    },
  };
}
