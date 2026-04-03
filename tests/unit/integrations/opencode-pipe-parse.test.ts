import { describe, it, expect } from "vitest";
import {
  parseOpencodeLine,
  type OpencodeStreamLine,
} from "../../../src/integrations/opencode/opencode-pipe.js";
import type { HarnessEvent } from "../../../src/harness/events.js";

const makeState = () => ({
  sessionEmitted: false,
  totalTokens: 0,
  model: "qwen3-coder-plus",
});

describe("parseOpencodeLine — opencode JSONL parser", () => {
  it("emits session_start on first step_start line", () => {
    const line: OpencodeStreamLine = {
      type: "step_start",
      timestamp: 1000,
      sessionID: "sess-oc",
    };
    const state = makeState();
    const events = Array.from(parseOpencodeLine(line, state));
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "session_start",
      sessionId: "sess-oc",
      model: "qwen3-coder-plus",
    });
    expect(state.sessionEmitted).toBe(true);
  });

  it("does not emit session_start on subsequent step_start lines", () => {
    const line: OpencodeStreamLine = {
      type: "step_start",
      timestamp: 1000,
      sessionID: "sess-oc",
    };
    const state = { ...makeState(), sessionEmitted: true };
    const events = Array.from(parseOpencodeLine(line, state));
    expect(events).toHaveLength(0);
  });

  it("emits text_delta from text line with part.text", () => {
    const line: OpencodeStreamLine = {
      type: "text",
      timestamp: 1000,
      sessionID: "sess-oc",
      part: { type: "text", text: "Hello world" },
    };
    const events = Array.from(parseOpencodeLine(line, makeState()));
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: "text_delta", text: "Hello world" });
  });

  it("yields nothing for text line with empty part.text", () => {
    const line: OpencodeStreamLine = {
      type: "text",
      timestamp: 1000,
      sessionID: "sess-oc",
      part: { type: "text", text: "" },
    };
    const events = Array.from(parseOpencodeLine(line, makeState()));
    expect(events).toHaveLength(0);
  });

  it("emits tool_use from tool_use line", () => {
    const line: OpencodeStreamLine = {
      type: "tool_use",
      timestamp: 1000,
      sessionID: "sess-oc",
      part: {
        type: "tool",
        tool: "read",
        callID: "call-1",
        state: { input: { path: "/foo/bar.ts" } },
      },
    };
    const events = Array.from(parseOpencodeLine(line, makeState()));
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "tool_use",
      id: "call-1",
      name: "read",
      input: { path: "/foo/bar.ts" },
    });
  });

  it("emits token_update from step_finish with tokens", () => {
    const line: OpencodeStreamLine = {
      type: "step_finish",
      timestamp: 1000,
      sessionID: "sess-oc",
      part: {
        type: "step-finish",
        reason: "stop",
        tokens: { input: 100, output: 50, total: 150 },
      },
    };
    const state = makeState();
    const events = Array.from(parseOpencodeLine(line, state));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "token_update", used: 150 });
    expect(state.totalTokens).toBe(150);
  });

  it("accumulates tokens across multiple step_finish lines", () => {
    const state = makeState();
    const mkLine = (input: number, output: number): OpencodeStreamLine => ({
      type: "step_finish",
      timestamp: 1000,
      sessionID: "sess-oc",
      part: {
        type: "step-finish",
        reason: "tool-calls",
        tokens: { input, output, total: input + output },
      },
    });
    Array.from(parseOpencodeLine(mkLine(100, 50), state));
    Array.from(parseOpencodeLine(mkLine(200, 80), state));
    const events = Array.from(parseOpencodeLine(mkLine(50, 20), state));
    const tokenUpdate = events.find((e) => e.type === "token_update");
    expect(tokenUpdate).toMatchObject({ type: "token_update", used: 500 });
  });

  it("yields nothing for error lines (handled by main loop)", () => {
    const line: OpencodeStreamLine = {
      type: "error",
      timestamp: 1000,
      sessionID: "sess-oc",
      error: { name: "SomeError", data: { message: "something failed" } },
    };
    const events = Array.from(parseOpencodeLine(line, makeState()));
    expect(events).toHaveLength(0);
  });

  it("yields nothing for unknown line types", () => {
    const line: OpencodeStreamLine = {
      type: "future_unknown_type",
      timestamp: 0,
      sessionID: "sess-oc",
    };
    const events = Array.from(parseOpencodeLine(line, makeState()));
    expect(events).toHaveLength(0);
  });
});

describe("heartbeat event", () => {
  it("heartbeat event has correct shape", () => {
    const now = Date.now();
    const hb: HarnessEvent = { type: "heartbeat", timestamp: now };
    expect(hb.type).toBe("heartbeat");
    expect((hb as { type: "heartbeat"; timestamp: number }).timestamp).toBe(
      now,
    );
  });
});
