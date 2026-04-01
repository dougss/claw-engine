import type { Message } from "../types.js";
import type { QueryEngineConfig } from "./query-engine-config.js";
import type { ModelAdapter } from "./model-adapters/adapter-types.js";

const COMPACTION_SYSTEM_PROMPT =
  "Summarize the conversation below concisely. Focus on: what was accomplished, what decisions were made, what still needs to be done. Be brief but preserve key context.";

export interface SerializedTranscript {
  messages: Message[];
  compactionCount: number;
  isFlushed: boolean;
}

export interface MicrocompactResult {
  clearedCount: number;
}

export interface TranscriptStore {
  compactionCount: number;
  isFlushed: boolean;

  addAssistantMessage(content: string): void;
  addToolResult(params: {
    toolUseId: string;
    toolName: string;
    output: string;
  }): void;

  shouldCompact(params: {
    config: QueryEngineConfig;
    currentTokenPercent: number;
  }): boolean;
  compact(params: {
    config: QueryEngineConfig;
    adapter: ModelAdapter;
  }): Promise<void>;
  microcompact(threshold?: number): MicrocompactResult;

  getMessages(): Message[];
  getMutableMessages(): Message[];
  getRecentMessages(n: number): Message[];
  estimateTokens(): number;
  toSerializable(): SerializedTranscript;
}

export function createTranscriptStore({
  systemPrompt,
  userPrompt,
  fromSerialized,
}: {
  systemPrompt: string;
  userPrompt: string;
  fromSerialized?: SerializedTranscript;
}): TranscriptStore {
  let messages: Message[] = fromSerialized
    ? [...fromSerialized.messages]
    : [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ];
  let compactionCount = fromSerialized?.compactionCount ?? 0;
  let isFlushed = fromSerialized?.isFlushed ?? false;
  const originalSystemPrompt = systemPrompt;

  function addAssistantMessage(content: string) {
    messages.push({ role: "assistant", content });
    isFlushed = false;
  }

  function addToolResult({
    toolUseId,
    toolName,
    output,
  }: {
    toolUseId: string;
    toolName: string;
    output: string;
  }) {
    messages.push({ role: "tool", content: output, toolUseId, toolName });
    isFlushed = false;
  }

  function shouldCompact({
    config,
    currentTokenPercent,
  }: {
    config: QueryEngineConfig;
    currentTokenPercent: number;
  }): boolean {
    if (!config.compactionEnabled) return false;
    if (currentTokenPercent < config.compactionThreshold * 100) return false;
    const nonSystemMessages = messages.filter((m) => m.role !== "system");
    if (nonSystemMessages.length <= config.compactionPreserveMessages) {
      return false;
    }
    return true;
  }

  async function compact({
    config,
    adapter,
  }: {
    config: QueryEngineConfig;
    adapter: ModelAdapter;
  }): Promise<void> {
    const preserveCount = config.compactionPreserveMessages;
    const nonSystemMessages = messages.filter((m) => m.role !== "system");

    if (nonSystemMessages.length <= preserveCount) return;

    const toSummarize = nonSystemMessages.slice(
      0,
      nonSystemMessages.length - preserveCount,
    );
    const toPreserve = nonSystemMessages.slice(
      nonSystemMessages.length - preserveCount,
    );

    const summaryMessages: Message[] = [
      { role: "system", content: COMPACTION_SYSTEM_PROMPT },
      {
        role: "user",
        content: toSummarize.map((m) => `[${m.role}]: ${m.content}`).join("\n"),
      },
    ];

    let summaryText = "";
    for await (const event of adapter.chat(summaryMessages, [])) {
      if (event.type === "text_delta") {
        summaryText += event.text;
      }
    }

    const nextMessages: Message[] = [
      { role: "system", content: originalSystemPrompt },
      {
        role: "system",
        content: `[Compacted transcript — summary of ${toSummarize.length} messages]\n${summaryText}`,
      },
      ...toPreserve,
    ];

    messages.length = 0;
    messages.push(...nextMessages);

    compactionCount++;
    isFlushed = true;
  }

  function microcompact(threshold = 20): MicrocompactResult {
    if (messages.length <= threshold) return { clearedCount: 0 };

    const STALE_CONTENT =
      "[Tool result cleared — stale content removed to save tokens]";
    const RECENT_TOOL_RESULTS_TO_KEEP = 5;

    const toolResultIndices = messages
      .map((m, i) => (m.role === "tool" ? i : -1))
      .filter((i) => i !== -1);

    if (toolResultIndices.length <= RECENT_TOOL_RESULTS_TO_KEEP) {
      return { clearedCount: 0 };
    }

    const indicesToClear = toolResultIndices.slice(
      0,
      toolResultIndices.length - RECENT_TOOL_RESULTS_TO_KEEP,
    );

    let clearedCount = 0;
    for (const idx of indicesToClear) {
      if (messages[idx].content !== STALE_CONTENT) {
        messages[idx] = { ...messages[idx], content: STALE_CONTENT };
        clearedCount++;
      }
    }

    return { clearedCount };
  }

  function getMessages(): Message[] {
    return [...messages];
  }

  function getMutableMessages(): Message[] {
    return messages;
  }

  function getRecentMessages(n: number): Message[] {
    return messages.slice(-n);
  }

  function estimateTokens(): number {
    let totalChars = 0;
    for (const msg of messages) {
      totalChars += msg.content.length;
    }
    return Math.ceil(totalChars / 4);
  }

  function toSerializable(): SerializedTranscript {
    return { messages: [...messages], compactionCount, isFlushed };
  }

  return {
    get compactionCount() {
      return compactionCount;
    },
    get isFlushed() {
      return isFlushed;
    },
    addAssistantMessage,
    addToolResult,
    shouldCompact,
    compact,
    microcompact,
    getMessages,
    getMutableMessages,
    getRecentMessages,
    estimateTokens,
    toSerializable,
  };
}
