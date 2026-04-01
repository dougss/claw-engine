import { describe, it, expect } from "vitest";
import { createQueryEnginePort } from "../../../src/harness/query-engine-port.js";
import { createQueryEngineConfig } from "../../../src/harness/query-engine-config.js";
import { createMockAdapter } from "../../../src/harness/model-adapters/mock-adapter.js";
import { createMemorySessionStore } from "../../../src/harness/session-store.js";
import type { HarnessEvent } from "../../../src/harness/events.js";
import type { ToolHandler } from "../../../src/harness/tools/tool-types.js";
import { PERMISSION_ACTION } from "../../../src/harness/permissions.js";

async function collectEvents(
  gen: AsyncGenerator<HarnessEvent>,
): Promise<HarnessEvent[]> {
  const events: HarnessEvent[] = [];
  for await (const e of gen) {
    events.push(e);
  }
  return events;
}

describe("QueryEnginePort", () => {
  it("runs a simple text-only session to completion", async () => {
    const adapter = createMockAdapter({
      name: "test",
      responses: [[{ type: "text_delta", text: "Hello world" }]],
    });
    const config = createQueryEngineConfig({
      sessionId: "sess-1",
      workspacePath: "/tmp/test",
      maxTurns: 10,
    });
    const sessionStore = createMemorySessionStore();
    const port = createQueryEnginePort({ config, adapter, sessionStore });

    const events = await collectEvents(port.run("Say hello"));
    const endEvent = events.find((e) => e.type === "session_end");
    expect(endEvent).toBeDefined();
    expect((endEvent as { reason: string }).reason).toBe("completed");
  });

  it("runs a session with tool use", async () => {
    const adapter = createMockAdapter({
      name: "test",
      responses: [
        [
          {
            type: "tool_use",
            id: "t1",
            name: "echo",
            input: { msg: "hi" },
          },
        ],
        [{ type: "text_delta", text: "Done" }],
      ],
    });

    const echoTool: ToolHandler = {
      name: "echo",
      description: "Echo",
      inputSchema: {},
      execute: async (input) => ({
        output: JSON.stringify(input),
        isError: false,
      }),
    };

    const config = createQueryEngineConfig({
      sessionId: "sess-2",
      workspacePath: "/tmp/test",
      maxTurns: 10,
    });
    const sessionStore = createMemorySessionStore();
    const port = createQueryEnginePort({
      config,
      adapter,
      sessionStore,
      toolHandlers: new Map([["echo", echoTool]]),
      permissionRules: [{ tool: "echo", action: PERMISSION_ACTION.allow }],
    });

    const events = await collectEvents(port.run("Use echo"));

    expect(events.some((e) => e.type === "tool_use")).toBe(true);
    expect(events.some((e) => e.type === "tool_result")).toBe(true);
    const endEvent = events[events.length - 1];
    expect(endEvent).toEqual({ type: "session_end", reason: "completed" });
  });

  it("triggers compaction when inner loop checkpoints at compaction threshold, then continues", async () => {
    const adapter = createMockAdapter({
      name: "test",
      responses: [
        // pass 1: exceeds compaction threshold (70) and checkpoints
        [
          { type: "text_delta", text: "Working..." },
          { type: "token_update", used: 92_160, budget: 128_000, percent: 72 },
        ],
        // runAgentLoop summary call for the checkpoint
        [{ type: "text_delta", text: "Summary: did step 1." }],
        // TranscriptStore.compact summarization call
        [{ type: "text_delta", text: "Compacted summary of conversation." }],
        // pass 2: completes normally under threshold
        [
          { type: "text_delta", text: "Continuing after compaction." },
          { type: "token_update", used: 30_000, budget: 128_000, percent: 23 },
        ],
      ],
    });

    const config = createQueryEngineConfig({
      sessionId: "compact-test",
      workspacePath: "/tmp",
      maxTurns: 10,
      compactionEnabled: true,
      compactionThreshold: 0.7,
      checkpointThreshold: 0.85,
      compactionPreserveMessages: 2,
    });
    const sessionStore = createMemorySessionStore();
    const port = createQueryEnginePort({ config, adapter, sessionStore });

    const events = await collectEvents(port.run("Do a big task"));

    const compactionEvents = events.filter((e) => e.type === "compaction");
    expect(compactionEvents.length).toBe(1);
    expect(events.some((e) => e.type === "checkpoint")).toBe(false);
    const endEvent = events[events.length - 1];
    expect(endEvent).toEqual({ type: "session_end", reason: "completed" });
  });

  it("emits multiple compactions across passes when still above threshold", async () => {
    const adapter = createMockAdapter({
      name: "test",
      responses: [
        // pass 1: checkpoint at 70
        [
          { type: "text_delta", text: "Work pass 1..." },
          { type: "token_update", used: 95_000, budget: 128_000, percent: 74 },
        ],
        [{ type: "text_delta", text: "Summary pass 1." }],
        [{ type: "text_delta", text: "Compacted 1." }],
        // pass 2: still checkpoints at 70
        [
          { type: "text_delta", text: "Work pass 2..." },
          { type: "token_update", used: 93_000, budget: 128_000, percent: 73 },
        ],
        [{ type: "text_delta", text: "Summary pass 2." }],
        [{ type: "text_delta", text: "Compacted 2." }],
        // pass 3: completes
        [
          { type: "text_delta", text: "All good now." },
          { type: "token_update", used: 20_000, budget: 128_000, percent: 16 },
        ],
      ],
    });

    const config = createQueryEngineConfig({
      sessionId: "multi-compact-test",
      workspacePath: "/tmp",
      maxTurns: 10,
      compactionEnabled: true,
      compactionThreshold: 0.7,
      checkpointThreshold: 0.85,
      compactionPreserveMessages: 1,
    });
    const sessionStore = createMemorySessionStore();
    const port = createQueryEnginePort({ config, adapter, sessionStore });

    const events = await collectEvents(port.run("Keep going"));
    const compactionEvents = events.filter((e) => e.type === "compaction");
    expect(compactionEvents.length).toBe(2);
    expect(events.some((e) => e.type === "checkpoint")).toBe(false);
    expect(events[events.length - 1]).toEqual({
      type: "session_end",
      reason: "completed",
    });
  });

  it("completes with no compaction when session stays below threshold", async () => {
    const adapter = createMockAdapter({
      name: "test",
      responses: [
        [
          { type: "text_delta", text: "Small task." },
          { type: "token_update", used: 10_000, budget: 128_000, percent: 8 },
        ],
      ],
    });

    const config = createQueryEngineConfig({
      sessionId: "no-compact-test",
      workspacePath: "/tmp",
      maxTurns: 10,
      compactionEnabled: true,
      compactionThreshold: 0.7,
      checkpointThreshold: 0.85,
    });
    const sessionStore = createMemorySessionStore();
    const port = createQueryEnginePort({ config, adapter, sessionStore });

    const events = await collectEvents(port.run("Small"));
    expect(events.some((e) => e.type === "compaction")).toBe(false);
    expect(events.some((e) => e.type === "checkpoint")).toBe(false);
    expect(events[events.length - 1]).toEqual({
      type: "session_end",
      reason: "completed",
    });
  });

  it("checkpoints (session dies) when compaction is disabled and token usage exceeds checkpoint threshold", async () => {
    const adapter = createMockAdapter({
      name: "test",
      responses: [
        [
          { type: "text_delta", text: "Too much context." },
          { type: "token_update", used: 115_000, budget: 128_000, percent: 90 },
        ],
        [{ type: "text_delta", text: "Final summary for resume." }],
      ],
    });

    const config = createQueryEngineConfig({
      sessionId: "cp-test",
      workspacePath: "/tmp",
      maxTurns: 10,
      compactionEnabled: false,
      compactionThreshold: 0.7,
      checkpointThreshold: 0.85,
      compactionPreserveMessages: 1,
    });
    const sessionStore = createMemorySessionStore();
    const port = createQueryEnginePort({ config, adapter, sessionStore });

    const events = await collectEvents(port.run("Huge task"));

    expect(events.some((e) => e.type === "compaction")).toBe(false);
    expect(events.some((e) => e.type === "checkpoint")).toBe(true);
    const endEvent = events[events.length - 1];
    expect(endEvent).toEqual({ type: "session_end", reason: "checkpoint" });
  });

  it("saves session state on checkpoint", async () => {
    const adapter = createMockAdapter({
      name: "test",
      responses: [
        [
          { type: "text_delta", text: "Still high." },
          { type: "token_update", used: 112_000, budget: 128_000, percent: 87 },
        ],
        [{ type: "text_delta", text: "Session summary for resume." }],
      ],
    });

    const config = createQueryEngineConfig({
      sessionId: "save-test",
      workspacePath: "/tmp",
      maxTurns: 10,
      compactionEnabled: false,
      compactionThreshold: 0.7,
      checkpointThreshold: 0.85,
    });
    const sessionStore = createMemorySessionStore();
    const port = createQueryEnginePort({ config, adapter, sessionStore });

    await collectEvents(port.run("Work"));

    const saved = await sessionStore.load("save-test");
    expect(saved).not.toBeNull();
    expect(saved?.sessionId).toBe("save-test");
    expect(saved?.metadata.status).toBe("checkpointed");
  });

  it("resumes from saved session state", async () => {
    const adapter = createMockAdapter({
      name: "test",
      responses: [[{ type: "text_delta", text: "Resumed and completed." }]],
    });

    const sessionStore = createMemorySessionStore();
    await sessionStore.save({
      sessionId: "resume-test",
      config: createQueryEngineConfig({
        sessionId: "resume-test",
        workspacePath: "/tmp",
      }),
      transcript: {
        messages: [
          { role: "system", content: "sys" },
          { role: "user", content: "original task" },
          { role: "assistant", content: "I was working on..." },
        ],
        compactionCount: 0,
        isFlushed: false,
      },
      usage: {
        totalInputTokens: 1000,
        totalOutputTokens: 500,
        turnCount: 2,
        toolCallCount: 1,
        permissionDenialCount: 0,
        currentPercent: 30,
      },
      metadata: {
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        status: "checkpointed",
      },
    });

    const config = createQueryEngineConfig({
      sessionId: "resume-test",
      workspacePath: "/tmp",
      maxTurns: 10,
    });
    const port = createQueryEnginePort({ config, adapter, sessionStore });

    const events = await collectEvents(port.resume("resume-test"));
    const endEvent = events[events.length - 1];
    expect(endEvent).toEqual({ type: "session_end", reason: "completed" });
  });
});
