import { describe, it, expect } from "vitest";
import {
  isToolUseEvent,
  isSessionEndEvent,
  isCompactionEvent,
  isApiRetryEvent,
  isModelFallbackEvent,
  isSessionResumeEvent,
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

describe("api_retry event", () => {
  it("isApiRetryEvent returns true for api_retry events", () => {
    const event = {
      type: "api_retry" as const,
      attempt: 1,
      maxAttempts: 5,
      delayMs: 500,
      error: "429 Too Many Requests",
    };
    expect(isApiRetryEvent(event)).toBe(true);
    expect(isApiRetryEvent({ type: "text_delta", text: "hi" })).toBe(false);
  });

  it("api_retry event has correct shape", () => {
    const event = {
      type: "api_retry" as const,
      attempt: 2,
      maxAttempts: 5,
      delayMs: 1000,
      error: "ECONNRESET",
    };
    expect(event.attempt).toBe(2);
    expect(event.maxAttempts).toBe(5);
    expect(event.delayMs).toBe(1000);
  });
});

describe("model_fallback event", () => {
  it("isModelFallbackEvent returns true for model_fallback events", () => {
    const event = {
      type: "model_fallback" as const,
      from: "qwen-plus",
      to: "qwen-turbo",
      reason: "rate_limit",
    };
    expect(isModelFallbackEvent(event)).toBe(true);
    expect(isModelFallbackEvent({ type: "text_delta", text: "hi" })).toBe(
      false,
    );
  });
});

describe("session_resume event", () => {
  it("isSessionResumeEvent returns true for session_resume events", () => {
    const event = {
      type: "session_resume" as const,
      sessionId: "abc-123",
      resumeCount: 1,
    };
    expect(isSessionResumeEvent(event)).toBe(true);
    expect(isSessionResumeEvent({ type: "text_delta", text: "hi" })).toBe(
      false,
    );
  });
});
