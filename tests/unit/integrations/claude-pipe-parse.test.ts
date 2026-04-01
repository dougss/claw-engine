import { describe, it, expect } from "vitest";
import {
  parseClaudeLine,
  type ClaudeStreamLine,
} from "../../../src/integrations/claude-p/claude-pipe.js";
import type { HarnessEvent } from "../../../src/harness/events.js";

describe("parseClaudeLine — stream-json parser", () => {
  it("emits session_start from system init line", () => {
    const line: ClaudeStreamLine = {
      type: "system",
      subtype: "init",
      session_id: "sess-abc",
      model: "claude-sonnet-4-5",
      tools: [],
    };

    const events = Array.from(parseClaudeLine(line));
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "session_start",
      sessionId: "sess-abc",
      model: "claude-sonnet-4-5",
    });
  });

  it("emits text_delta from assistant text block", () => {
    const line: ClaudeStreamLine = {
      type: "assistant",
      message: {
        id: "msg-1",
        role: "assistant",
        content: [{ type: "text", text: "I will help you." }],
      },
    };

    const events = Array.from(parseClaudeLine(line));
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: "text_delta", text: "I will help you." });
  });

  it("emits tool_use from assistant tool_use block", () => {
    const line: ClaudeStreamLine = {
      type: "assistant",
      message: {
        id: "msg-2",
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tu-1",
            name: "bash",
            input: { command: "ls -la" },
          },
        ],
      },
    };

    const events = Array.from(parseClaudeLine(line));
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "tool_use",
      id: "tu-1",
      name: "bash",
      input: { command: "ls -la" },
    });
  });

  it("emits multiple events from assistant message with mixed content", () => {
    const line: ClaudeStreamLine = {
      type: "assistant",
      message: {
        id: "msg-3",
        role: "assistant",
        content: [
          { type: "text", text: "Running command..." },
          {
            type: "tool_use",
            id: "tu-2",
            name: "bash",
            input: { command: "pwd" },
          },
        ],
      },
    };

    const events = Array.from(parseClaudeLine(line));
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({
      type: "text_delta",
      text: "Running command...",
    });
    expect(events[1]).toMatchObject({ type: "tool_use", name: "bash" });
  });

  it("emits session_end completed from result success line", () => {
    const line: ClaudeStreamLine = {
      type: "result",
      subtype: "success",
      result: "Done",
      session_id: "sess-abc",
      cost_usd: 0.001,
      usage: { input_tokens: 100, output_tokens: 50 },
    };

    const events = Array.from(parseClaudeLine(line));
    // Expect token_update + session_end
    const tokenUpdate = events.find((e) => e.type === "token_update");
    expect(tokenUpdate).toMatchObject({ type: "token_update", used: 150 });

    const end = events.find((e) => e.type === "session_end");
    expect(end).toEqual({ type: "session_end", reason: "completed" });
  });

  it("emits session_end max_iterations from result max_turns line", () => {
    const line: ClaudeStreamLine = {
      type: "result",
      subtype: "max_turns",
      session_id: "sess-abc",
    };

    const events = Array.from(parseClaudeLine(line));
    expect(
      events.some(
        (e) =>
          e.type === "session_end" &&
          (e as { reason: string }).reason === "max_iterations",
      ),
    ).toBe(true);
  });

  it("emits session_end error from result error_during_execution line", () => {
    const line: ClaudeStreamLine = {
      type: "result",
      subtype: "error_during_execution",
      session_id: "sess-abc",
      error: "something failed",
    };

    const events = Array.from(parseClaudeLine(line));
    expect(
      events.some(
        (e) =>
          e.type === "session_end" &&
          (e as { reason: string }).reason === "error",
      ),
    ).toBe(true);
  });

  it("yields nothing for user (tool_result) lines", () => {
    const line: ClaudeStreamLine = {
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tu-1",
            content: [{ type: "text", text: "file contents" }],
          },
        ],
      },
    };

    const events = Array.from(parseClaudeLine(line));
    // user/tool_result lines are just confirmations — no HarnessEvents needed
    expect(events).toHaveLength(0);
  });

  it("returns empty array for unknown line type", () => {
    const line = { type: "unknown_future_type" } as ClaudeStreamLine;
    const events = Array.from(parseClaudeLine(line));
    expect(events).toHaveLength(0);
  });
});
