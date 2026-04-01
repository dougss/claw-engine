import type { ToolDefinition } from "../types.js";
import type { HarnessEvent } from "../harness/events.js";
import { runAgentLoop } from "../harness/agent-loop.js";
import type { ModelAdapter } from "../harness/model-adapters/adapter-types.js";
import type { ToolHandler } from "../harness/tools/tool-types.js";

export async function runSingleSession({
  adapter,
  systemPrompt,
  userPrompt,
  tools,
  workspacePath,
  maxIterations,
  toolHandlers,
}: {
  adapter: ModelAdapter;
  systemPrompt: string;
  userPrompt: string;
  tools: ToolDefinition[];
  workspacePath: string;
  maxIterations: number;
  toolHandlers?: Map<string, ToolHandler>;
}): Promise<{ events: HarnessEvent[]; endReason: string }> {
  const events: HarnessEvent[] = [];
  let endReason = "unknown";

  for await (const event of runAgentLoop({
    adapter,
    systemPrompt,
    userPrompt,
    tools,
    maxIterations,
    tokenBudget: 128_000,
    workspacePath,
    toolHandlers,
  })) {
    events.push(event);
    if (event.type === "session_end") {
      endReason = event.reason;
    }
  }

  return { events, endReason };
}
