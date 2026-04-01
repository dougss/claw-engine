import type { Message, ToolDefinition } from "../../types.js";
import type { HarnessEvent } from "../events.js";
import type { ModelAdapter } from "./adapter-types.js";

interface AlibabaAdapterOptions {
  name: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  maxContext?: number;
}

export function createAlibabaAdapter({
  name,
  model,
  apiKey,
  baseUrl = "https://dashscope.aliyuncs.com/compatible-mode/v1",
  maxContext = 128000,
}: AlibabaAdapterOptions): ModelAdapter {
  return {
    name,
    provider: "alibaba",
    maxContext,
    supportsToolUse: true,
    supportsStreaming: true,
    costPerInputToken: 0,
    costPerOutputToken: 0,

    async *chat(
      _messages: Message[],
      _tools: ToolDefinition[],
    ): AsyncIterable<HarnessEvent> {
      if (!apiKey) {
        throw new Error(
          `AlibabaAdapter (${name}) missing apiKey. Provide apiKey to call ${baseUrl} with model ${model}.`,
        );
      }

      throw new Error(
        `AlibabaAdapter (${name}) is not implemented yet (model: ${model}).`,
      );
    },
  };
}
