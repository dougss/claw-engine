import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { createMockAdapter } from "../../../src/harness/model-adapters/mock-adapter.js";
import { runAgentLoop } from "../../../src/harness/agent-loop.js";
import { recordEvents } from "../../../src/harness/recordings/recorder.js";
import type { HarnessEvent } from "../../../src/harness/events.js";

describe("checkpoint — token budget triggering", () => {
  it("yields checkpoint + session_end(checkpoint) when token_update percent >= 85", async () => {
    const adapter = createMockAdapter({
      name: "test",
      responses: [
        // First turn: text + high token usage
        [
          { type: "text_delta", text: "Working on the task..." },
          { type: "token_update", used: 108_800, budget: 128_000, percent: 85 },
        ],
        // Summary turn — injected by agent-loop when threshold hit
        [
          {
            type: "text_delta",
            text: "Summary: completed step 1, step 2 remains.",
          },
        ],
      ],
    });

    const events: HarnessEvent[] = [];
    for await (const e of runAgentLoop({
      adapter,
      systemPrompt: "sys",
      userPrompt: "do something",
      tools: [],
      maxIterations: 5,
      tokenBudget: 128_000,
      workspacePath: "/tmp",
    })) {
      events.push(e);
    }

    const checkpointIdx = events.findIndex((e) => e.type === "checkpoint");
    expect(checkpointIdx).toBeGreaterThanOrEqual(0);
    expect(events[checkpointIdx]).toEqual({
      type: "checkpoint",
      reason: "token_limit",
    });
    expect(events[events.length - 1]).toEqual({
      type: "session_end",
      reason: "checkpoint",
    });
  });

  it("completes normally when token_update percent < 85", async () => {
    const adapter = createMockAdapter({
      name: "test",
      responses: [
        [
          { type: "text_delta", text: "Done." },
          { type: "token_update", used: 50_000, budget: 128_000, percent: 39 },
        ],
      ],
    });

    const events: HarnessEvent[] = [];
    for await (const e of runAgentLoop({
      adapter,
      systemPrompt: "sys",
      userPrompt: "do something",
      tools: [],
      maxIterations: 5,
      tokenBudget: 128_000,
      workspacePath: "/tmp",
    })) {
      events.push(e);
    }

    expect(events.some((e) => e.type === "checkpoint")).toBe(false);
    expect(events[events.length - 1]).toEqual({
      type: "session_end",
      reason: "completed",
    });
  });

  it("respects custom checkpointThresholdPercent", async () => {
    const adapter = createMockAdapter({
      name: "test",
      responses: [
        [
          { type: "text_delta", text: "Work..." },
          // Only 60% — below default 85 but above custom 50
          { type: "token_update", used: 64_000, budget: 128_000, percent: 50 },
        ],
        [{ type: "text_delta", text: "Summary." }],
      ],
    });

    const events: HarnessEvent[] = [];
    for await (const e of runAgentLoop({
      adapter,
      systemPrompt: "sys",
      userPrompt: "go",
      tools: [],
      maxIterations: 5,
      tokenBudget: 128_000,
      workspacePath: "/tmp",
      checkpointThresholdPercent: 50,
    })) {
      events.push(e);
    }

    expect(events.some((e) => e.type === "checkpoint")).toBe(true);
    expect(events[events.length - 1]).toEqual({
      type: "session_end",
      reason: "checkpoint",
    });
  });

  it("includes summary text before checkpoint event", async () => {
    const adapter = createMockAdapter({
      name: "test",
      responses: [
        [
          { type: "text_delta", text: "Initial work." },
          { type: "token_update", used: 110_000, budget: 128_000, percent: 86 },
        ],
        [{ type: "text_delta", text: "Summary: finished auth module." }],
      ],
    });

    const events: HarnessEvent[] = [];
    for await (const e of runAgentLoop({
      adapter,
      systemPrompt: "sys",
      userPrompt: "build auth",
      tools: [],
      maxIterations: 5,
      tokenBudget: 128_000,
      workspacePath: "/tmp",
    })) {
      events.push(e);
    }

    const checkpointIdx = events.findIndex((e) => e.type === "checkpoint");
    // Summary text_delta should appear before the checkpoint event
    const summaryEvents = events
      .slice(0, checkpointIdx)
      .filter(
        (e) =>
          e.type === "text_delta" &&
          (e as { text: string }).text.includes("Summary"),
      );
    expect(summaryEvents.length).toBeGreaterThan(0);
  });
});

describe("session recording", () => {
  it("writes all events to a JSONL file while passing them through", async () => {
    const adapter = createMockAdapter({
      name: "test",
      responses: [
        [
          { type: "text_delta", text: "hello" },
          { type: "token_update", used: 100, budget: 1000, percent: 10 },
        ],
      ],
    });

    const recordingPath = join(tmpdir(), `recording-${Date.now()}.jsonl`);

    const passedThrough: HarnessEvent[] = [];
    for await (const e of recordEvents({
      source: runAgentLoop({
        adapter,
        systemPrompt: "sys",
        userPrompt: "hi",
        tools: [],
        maxIterations: 3,
        tokenBudget: 1_000,
        workspacePath: "/tmp",
      }),
      recordingPath,
    })) {
      passedThrough.push(e);
    }

    // Verify pass-through: text_delta + token_update + session_end
    expect(passedThrough).toHaveLength(3);
    expect(passedThrough[0]).toEqual({ type: "text_delta", text: "hello" });
    expect(passedThrough[2]).toEqual({
      type: "session_end",
      reason: "completed",
    });

    // Verify file was written
    const fileContent = await readFile(recordingPath, "utf8");
    const lines = fileContent.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(3);

    const parsed = lines.map((l) => JSON.parse(l));
    expect(parsed.every((r: { ts: number }) => typeof r.ts === "number")).toBe(
      true,
    );
    expect(parsed[0].event).toEqual({ type: "text_delta", text: "hello" });
    expect(parsed[2].event).toEqual({
      type: "session_end",
      reason: "completed",
    });
  });
});
