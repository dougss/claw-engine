import { describe, it, expect } from "vitest";
import { createTranscriptStore } from "../../../src/harness/transcript-store.js";
import type { QueryEngineConfig } from "../../../src/harness/query-engine-config.js";
import { createQueryEngineConfig } from "../../../src/harness/query-engine-config.js";
import { createMockAdapter } from "../../../src/harness/model-adapters/mock-adapter.js";

function makeConfig(
  overrides: Partial<QueryEngineConfig> = {},
): QueryEngineConfig {
  return createQueryEngineConfig({
    compactionEnabled: true,
    compactionThreshold: 0.7,
    compactionPreserveMessages: 2,
    maxTokens: 1000,
    ...overrides,
  });
}

describe("TranscriptStore", () => {
  it("starts with initial system and user messages", () => {
    const store = createTranscriptStore({
      systemPrompt: "You are a helper.",
      userPrompt: "Do X.",
    });
    const msgs = store.getMessages();
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("system");
    expect(msgs[1].role).toBe("user");
  });

  it("appends assistant messages", () => {
    const store = createTranscriptStore({
      systemPrompt: "sys",
      userPrompt: "hi",
    });
    store.addAssistantMessage("Hello!");
    expect(store.getMessages()).toHaveLength(3);
    expect(store.getMessages()[2]).toEqual({
      role: "assistant",
      content: "Hello!",
    });
  });

  it("appends tool result messages", () => {
    const store = createTranscriptStore({
      systemPrompt: "sys",
      userPrompt: "hi",
    });
    store.addToolResult({
      toolUseId: "t1",
      toolName: "read_file",
      output: "file contents",
    });
    const last = store.getMessages()[2];
    expect(last.role).toBe("tool");
    expect(last.toolUseId).toBe("t1");
  });

  it("getRecentMessages returns the last N messages", () => {
    const store = createTranscriptStore({
      systemPrompt: "sys",
      userPrompt: "hi",
    });
    store.addAssistantMessage("msg1");
    store.addAssistantMessage("msg2");
    store.addAssistantMessage("msg3");

    const recent = store.getRecentMessages(2);
    expect(recent).toHaveLength(2);
    expect(recent[0].content).toBe("msg2");
    expect(recent[1].content).toBe("msg3");
  });

  it("estimateTokens returns rough char/4 count", () => {
    const store = createTranscriptStore({
      systemPrompt: "a".repeat(400),
      userPrompt: "b".repeat(400),
    });
    const tokens = store.estimateTokens();
    expect(tokens).toBeGreaterThanOrEqual(200);
    expect(tokens).toBeLessThanOrEqual(210);
  });

  it("shouldCompact returns false when below threshold", () => {
    const config = makeConfig();
    const store = createTranscriptStore({
      systemPrompt: "sys",
      userPrompt: "hi",
    });
    expect(store.shouldCompact({ config, currentTokenPercent: 50 })).toBe(
      false,
    );
  });

  it("shouldCompact returns true when above threshold", () => {
    const config = makeConfig();
    const store = createTranscriptStore({
      systemPrompt: "sys",
      userPrompt: "hi",
    });
    store.addAssistantMessage("msg1");
    store.addAssistantMessage("msg2");
    store.addAssistantMessage("msg3");
    expect(store.shouldCompact({ config, currentTokenPercent: 75 })).toBe(true);
  });

  it("shouldCompact returns false when compaction is disabled", () => {
    const config = makeConfig({ compactionEnabled: false });
    const store = createTranscriptStore({
      systemPrompt: "sys",
      userPrompt: "hi",
    });
    store.addAssistantMessage("msg1");
    store.addAssistantMessage("msg2");
    store.addAssistantMessage("msg3");
    expect(store.shouldCompact({ config, currentTokenPercent: 75 })).toBe(
      false,
    );
  });

  it("shouldCompact returns false when not enough messages to compact", () => {
    const config = makeConfig({ compactionPreserveMessages: 10 });
    const store = createTranscriptStore({
      systemPrompt: "sys",
      userPrompt: "hi",
    });
    store.addAssistantMessage("msg1");
    expect(store.shouldCompact({ config, currentTokenPercent: 75 })).toBe(
      false,
    );
  });

  it("compact replaces old messages with summary + preserves recent", async () => {
    const config = makeConfig({ compactionPreserveMessages: 2 });
    const adapter = createMockAdapter({
      name: "compact-mock",
      responses: [
        [{ type: "text_delta", text: "Summary of conversation so far." }],
      ],
    });

    const store = createTranscriptStore({
      systemPrompt: "You are a helper.",
      userPrompt: "Do task A.",
    });
    store.addAssistantMessage("Working on A...");
    store.addAssistantMessage("Done with part 1.");
    store.addAssistantMessage("Working on part 2.");
    store.addAssistantMessage("Almost done.");

    expect(store.getMessages()).toHaveLength(6);
    expect(store.compactionCount).toBe(0);
    expect(store.isFlushed).toBe(false);

    await store.compact({ config, adapter });

    const msgs = store.getMessages();
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toBe("You are a helper.");
    expect(msgs[1].role).toBe("system");
    expect(msgs[1].content).toContain("Summary of conversation so far.");
    expect(msgs[msgs.length - 2].content).toBe("Working on part 2.");
    expect(msgs[msgs.length - 1].content).toBe("Almost done.");
    expect(store.compactionCount).toBe(1);
    expect(store.isFlushed).toBe(true);
  });

  it("multiple compactions increment compactionCount", async () => {
    const config = makeConfig({ compactionPreserveMessages: 1 });
    const adapter = createMockAdapter({
      name: "compact-mock",
      responses: [
        [{ type: "text_delta", text: "Summary 1" }],
        [{ type: "text_delta", text: "Summary 2" }],
      ],
    });

    const store = createTranscriptStore({
      systemPrompt: "sys",
      userPrompt: "go",
    });
    store.addAssistantMessage("a");
    store.addAssistantMessage("b");
    store.addAssistantMessage("c");
    await store.compact({ config, adapter });
    expect(store.compactionCount).toBe(1);

    store.addAssistantMessage("d");
    store.addAssistantMessage("e");
    await store.compact({ config, adapter });
    expect(store.compactionCount).toBe(2);
  });

  it("toSerializable/fromSerializable roundtrip", () => {
    const store = createTranscriptStore({
      systemPrompt: "sys",
      userPrompt: "hi",
    });
    store.addAssistantMessage("hello");

    const serialized = store.toSerializable();
    const restored = createTranscriptStore({
      systemPrompt: "sys",
      userPrompt: "hi",
      fromSerialized: serialized,
    });

    expect(restored.getMessages()).toEqual(store.getMessages());
    expect(restored.compactionCount).toBe(store.compactionCount);
    expect(restored.isFlushed).toBe(store.isFlushed);
  });
});
