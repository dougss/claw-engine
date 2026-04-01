import type { Message, ToolDefinition, ToolResult } from "../types.js";
import type { HarnessEvent } from "./events.js";
import type { ModelAdapter } from "./model-adapters/adapter-types.js";
import { getTool } from "./tools/tool-registry.js";
import type { ToolContext, ToolHandler } from "./tools/tool-types.js";

export interface RunAgentLoopInput {
  adapter: ModelAdapter;
  systemPrompt: string;
  userPrompt: string;
  tools: ToolDefinition[];
  maxIterations: number;
  tokenBudget: number;
  workspacePath: string;
  toolHandlers?: Map<string, ToolHandler>;
  sessionId?: string;
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

async function executeTool({
  handler,
  input,
  context,
}: {
  handler: ToolHandler;
  input: unknown;
  context: ToolContext;
}): Promise<ToolResult> {
  return handler.execute(input, context);
}

export async function* runAgentLoop({
  adapter,
  systemPrompt,
  userPrompt,
  tools,
  maxIterations,
  tokenBudget: _tokenBudget,
  workspacePath,
  toolHandlers,
  sessionId = "test-session",
}: RunAgentLoopInput): AsyncGenerator<HarnessEvent> {
  const messages: Message[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  for (let i = 0; i < maxIterations; i++) {
    let sawToolUse = false;
    let assistantText = "";

    for await (const event of adapter.chat(messages, tools)) {
      yield event;

      if (event.type === "text_delta") {
        assistantText += event.text;
      }

      if (event.type !== "tool_use") continue;

      sawToolUse = true;

      const handler = getToolHandler({ name: event.name, toolHandlers });

      if (!handler) {
        const toolResultEvent: HarnessEvent = {
          type: "tool_result",
          id: event.id,
          output: `Tool not found: ${event.name}`,
          isError: true,
        };

        yield toolResultEvent;
        messages.push(
          createToolMessage({
            toolUseId: event.id,
            toolName: event.name,
            output: toolResultEvent.output,
          }),
        );
        continue;
      }

      const result = await executeTool({
        handler,
        input: event.input,
        context: { workspacePath, sessionId },
      });

      const toolResultEvent: HarnessEvent = {
        type: "tool_result",
        id: event.id,
        output: result.output,
        isError: result.isError,
      };

      yield toolResultEvent;
      messages.push(
        createToolMessage({
          toolUseId: event.id,
          toolName: event.name,
          output: result.output,
        }),
      );
    }

    if (assistantText) {
      messages.push(createAssistantMessage(assistantText));
    }

    if (!sawToolUse) {
      yield { type: "session_end", reason: "completed" };
      return;
    }
  }

  yield { type: "session_end", reason: "max_iterations" };
}
