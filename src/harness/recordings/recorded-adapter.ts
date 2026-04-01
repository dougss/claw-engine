import { readFile } from "node:fs/promises";
import type { Message, ToolDefinition } from "../../types.js";
import type { HarnessEvent } from "../events.js";
import type { ModelAdapter } from "../model-adapters/adapter-types.js";
import { parseRecording } from "./recording-format.js";

// Meta-events that the agent-loop generates itself — strip them from replays
// so the loop doesn't get confused by double session_end/checkpoint events.
function isMetaEvent(event: HarnessEvent): boolean {
  return event.type === "session_end" || event.type === "checkpoint";
}

/**
 * Creates a ModelAdapter that replays events from a JSONL recording file,
 * splitting them into turns at session_end/checkpoint boundaries.
 *
 * Useful for deterministic regression tests that need to replay a real session
 * without making live model API calls.
 */
export async function createRecordedAdapter({
  recordingPath,
  name,
}: {
  recordingPath: string;
  name?: string;
}): Promise<ModelAdapter> {
  const content = await readFile(recordingPath, "utf8");
  const allEvents = parseRecording(content).map((r) => r.event);

  // Group into turns: each turn ends at the first session_end or checkpoint
  const turns: HarnessEvent[][] = [];
  let current: HarnessEvent[] = [];

  for (const event of allEvents) {
    current.push(event);
    if (isMetaEvent(event)) {
      turns.push(current);
      current = [];
    }
  }
  if (current.length > 0) turns.push(current);

  let turnIndex = 0;

  return {
    name: name ?? `recorded:${recordingPath}`,
    provider: "mock",
    maxContext: 128_000,
    supportsToolUse: true,
    supportsStreaming: true,
    costPerInputToken: 0,
    costPerOutputToken: 0,

    async *chat(
      _messages: Message[],
      _tools: ToolDefinition[],
    ): AsyncIterable<HarnessEvent> {
      const events = turns[turnIndex] ?? [];
      turnIndex++;
      for (const event of events) {
        if (!isMetaEvent(event)) {
          yield event;
        }
      }
    },
  };
}
