import type { Message, ToolDefinition } from "../../types.js";
import type { HarnessEvent } from "../events.js";

export interface ModelAdapter {
  name: string;
  provider: "alibaba" | "anthropic" | "google" | "openai" | "local" | "mock";
  maxContext: number;
  supportsToolUse: boolean;
  supportsStreaming: boolean;
  costPerInputToken: number;
  costPerOutputToken: number;
  chat(
    messages: Message[],
    tools: ToolDefinition[],
  ): AsyncIterable<HarnessEvent>;
}
