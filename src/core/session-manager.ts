import type { Message, ToolDefinition } from "../types.js";
import type { HarnessEvent } from "../harness/events.js";
import { runAgentLoop } from "../harness/agent-loop.js";
import type { ModelAdapter } from "../harness/model-adapters/adapter-types.js";
import type { ToolHandler } from "../harness/tools/tool-types.js";

/** Checkpoint data from a previous session used to resume work. */
export interface ResumeCheckpoint {
  /** Summary text produced by the agent before the checkpoint. */
  summary: string;
  /** Recent messages for context continuity. */
  recentMessages?: Message[];
}

export async function runSingleSession({
  adapter,
  systemPrompt,
  userPrompt,
  tools,
  workspacePath,
  maxIterations,
  toolHandlers,
  resumeCheckpoint,
  checkpointThresholdPercent,
}: {
  adapter: ModelAdapter;
  systemPrompt: string;
  userPrompt: string;
  tools: ToolDefinition[];
  workspacePath: string;
  maxIterations: number;
  toolHandlers?: Map<string, ToolHandler>;
  resumeCheckpoint?: ResumeCheckpoint;
  checkpointThresholdPercent?: number;
}): Promise<{ events: HarnessEvent[]; endReason: string }> {
  // Build effective system prompt: append checkpoint block if resuming
  let effectiveSystemPrompt = systemPrompt;
  if (resumeCheckpoint) {
    const checkpointBlock = [
      "\n\n---\n\nCHECKPOINT",
      JSON.stringify(
        {
          summary: resumeCheckpoint.summary,
          recentMessages: resumeCheckpoint.recentMessages ?? [],
        },
        null,
        2,
      ),
    ].join("\n");
    effectiveSystemPrompt = systemPrompt + checkpointBlock;
  }

  const events: HarnessEvent[] = [];
  let endReason = "unknown";

  for await (const event of runAgentLoop({
    adapter,
    systemPrompt: effectiveSystemPrompt,
    userPrompt,
    tools,
    maxIterations,
    tokenBudget: 128_000,
    workspacePath,
    toolHandlers,
    checkpointThresholdPercent,
  })) {
    events.push(event);
    if (event.type === "session_end") {
      endReason = event.reason;
    }
  }

  return { events, endReason };
}
