import type { Message, ToolDefinition } from "../../types.js";
import type { HarnessEvent } from "../events.js";
import type { ModelAdapter } from "./adapter-types.js";

interface MockAdapterOptions {
  name: string;
  responses: HarnessEvent[][];
  maxContext?: number;
}

export function createMockAdapter({
  name,
  responses,
  maxContext = 128000,
}: MockAdapterOptions): ModelAdapter {
  let callIndex = 0;

  return {
    name,
    provider: "mock",
    maxContext,
    supportsToolUse: true,
    supportsStreaming: true,
    costPerInputToken: 0,
    costPerOutputToken: 0,

    async *chat(
      _messages: Message[],
      _tools: ToolDefinition[],
    ): AsyncIterable<HarnessEvent> {
      const events = responses[callIndex] ?? [];
      callIndex++;
      for (const event of events) {
        yield event;
      }
    },
  };
}
