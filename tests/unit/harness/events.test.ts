import { describe, it, expect } from "vitest";
import {
  isToolUseEvent,
  isSessionEndEvent,
  isCompactionEvent,
  createTextDelta,
  createTokenUpdate,
} from "../../../src/harness/events.js";

describe("HarnessEvent helpers", () => {
  it("createTextDelta produces correct shape", () => {
    const event = createTextDelta("hello");
    expect(event.type).toBe("text_delta");
    expect(event.text).toBe("hello");
  });

  it("createTokenUpdate computes percent", () => {
    const event = createTokenUpdate({ used: 85000, budget: 100000 });
    expect(event.percent).toBe(85);
  });

  it("isToolUseEvent returns true for tool_use", () => {
    expect(
      isToolUseEvent({ type: "tool_use", id: "1", name: "bash", input: {} }),
    ).toBe(true);
    expect(isToolUseEvent({ type: "text_delta", text: "hi" })).toBe(false);
  });

  it("isSessionEndEvent detects session_end", () => {
    expect(
      isSessionEndEvent({ type: "session_end", reason: "completed" }),
    ).toBe(true);
  });
});

describe("compaction event", () => {
  it("isCompactionEvent returns true for compaction events", () => {
    const event = {
      type: "compaction" as const,
      messagesBefore: 20,
      messagesAfter: 6,
      compactionCount: 1,
    };
    expect(isCompactionEvent(event)).toBe(true);
    expect(isCompactionEvent({ type: "text_delta", text: "hi" })).toBe(false);
  });
});
