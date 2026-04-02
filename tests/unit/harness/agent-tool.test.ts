import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HarnessEvent } from "../../../src/harness/events.js";

// ── Mock runClaudePipe before importing the tool ────────────────────────────
vi.mock("../../../src/integrations/claude-p/claude-pipe.js", () => ({
  runClaudePipe: vi.fn(),
}));

import { spawnAgentTool } from "../../../src/harness/tools/builtins/agent-tool.js";
import { runClaudePipe } from "../../../src/integrations/claude-p/claude-pipe.js";

// Helper: create an async generator from an array of HarnessEvents
async function* makeEventStream(
  events: HarnessEvent[],
): AsyncGenerator<HarnessEvent> {
  for (const event of events) {
    yield event;
  }
}

const mockContext = {
  workspacePath: "/workspace/default",
  sessionId: "sess-test-001",
  workItemId: "wi-test-abc",
};

describe("spawnAgentTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Basic structure ─────────────────────────────────────────────────────────
  it("has the correct name and required prompt in schema", () => {
    expect(spawnAgentTool.name).toBe("spawn_agent");
    expect(spawnAgentTool.inputSchema).toMatchObject({
      required: ["prompt"],
    });
  });

  // ── Invalid input ───────────────────────────────────────────────────────────
  it("returns error for missing prompt", async () => {
    const result = await spawnAgentTool.execute({}, mockContext);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("invalid input");
  });

  it("returns error for non-string prompt", async () => {
    const result = await spawnAgentTool.execute({ prompt: 42 }, mockContext);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("invalid input");
  });

  // ── Foreground: collects text_delta events ──────────────────────────────────
  describe("foreground (background: false)", () => {
    it("returns collected text from text_delta events", async () => {
      const events: HarnessEvent[] = [
        { type: "session_start", sessionId: "s1", model: "claude" },
        { type: "text_delta", text: "Hello, " },
        { type: "text_delta", text: "world!" },
        { type: "session_end", reason: "completed" },
      ];
      vi.mocked(runClaudePipe).mockReturnValue(makeEventStream(events));

      const result = await spawnAgentTool.execute(
        { prompt: "say hello" },
        mockContext,
      );

      expect(result.isError).toBe(false);
      expect(result.output).toBe("Hello, world!");
    });

    it("returns fallback message when agent produces no text output", async () => {
      const events: HarnessEvent[] = [
        { type: "session_start", sessionId: "s2", model: "claude" },
        { type: "session_end", reason: "completed" },
      ];
      vi.mocked(runClaudePipe).mockReturnValue(makeEventStream(events));

      const result = await spawnAgentTool.execute(
        { prompt: "silent task" },
        mockContext,
      );

      expect(result.isError).toBe(false);
      expect(result.output).toBe("(agent produced no output)");
    });

    it("returns error when runClaudePipe throws", async () => {
      vi.mocked(runClaudePipe).mockImplementation(async function* () {
        throw new Error("claude binary not found");
      });

      const result = await spawnAgentTool.execute(
        { prompt: "failing task" },
        mockContext,
      );

      expect(result.isError).toBe(true);
      expect(result.output).toContain("agent failed");
      expect(result.output).toContain("claude binary not found");
    });

    it("passes maxTurns to runClaudePipe when provided", async () => {
      vi.mocked(runClaudePipe).mockReturnValue(makeEventStream([]));

      await spawnAgentTool.execute(
        { prompt: "task", maxTurns: 5 },
        mockContext,
      );

      expect(runClaudePipe).toHaveBeenCalledWith(
        expect.objectContaining({ maxTurns: 5 }),
      );
    });

    it("ignores non-integer maxTurns (NaN/Infinity)", async () => {
      vi.mocked(runClaudePipe).mockReturnValue(makeEventStream([]));

      await spawnAgentTool.execute(
        { prompt: "task", maxTurns: Infinity },
        mockContext,
      );

      const call = vi.mocked(runClaudePipe).mock.calls[0][0];
      expect(call.maxTurns).toBeUndefined();
    });
  });

  // ── context.workspacePath fallback ──────────────────────────────────────────
  describe("workspacePath resolution", () => {
    it("uses context.workspacePath when workspacePath not provided in input", async () => {
      vi.mocked(runClaudePipe).mockReturnValue(makeEventStream([]));

      await spawnAgentTool.execute({ prompt: "task" }, mockContext);

      expect(runClaudePipe).toHaveBeenCalledWith(
        expect.objectContaining({ workspacePath: "/workspace/default" }),
      );
    });

    it("uses input.workspacePath when provided", async () => {
      vi.mocked(runClaudePipe).mockReturnValue(makeEventStream([]));

      await spawnAgentTool.execute(
        { prompt: "task", workspacePath: "/custom/path" },
        mockContext,
      );

      expect(runClaudePipe).toHaveBeenCalledWith(
        expect.objectContaining({ workspacePath: "/custom/path" }),
      );
    });

    it("uses worktree param as workspacePath override", async () => {
      vi.mocked(runClaudePipe).mockReturnValue(makeEventStream([]));

      await spawnAgentTool.execute(
        { prompt: "task", worktree: "/worktree/path" },
        mockContext,
      );

      expect(runClaudePipe).toHaveBeenCalledWith(
        expect.objectContaining({ workspacePath: "/worktree/path" }),
      );
    });

    it("worktree overrides workspacePath when both are provided", async () => {
      vi.mocked(runClaudePipe).mockReturnValue(makeEventStream([]));

      await spawnAgentTool.execute(
        {
          prompt: "task",
          workspacePath: "/custom/path",
          worktree: "/worktree/path",
        },
        mockContext,
      );

      expect(runClaudePipe).toHaveBeenCalledWith(
        expect.objectContaining({ workspacePath: "/worktree/path" }),
      );
    });
  });

  // ── Background: returns taskId immediately ──────────────────────────────────
  describe("background (background: true)", () => {
    it("returns a taskId in agent-{timestamp}-{seq} format without waiting", async () => {
      // Use a fast-completing generator — execute() returns before generator
      // finishes regardless (background mode never awaits the pipe).
      // A completing generator also lets the Map entry clean up via .finally(),
      // keeping module-level state tidy for subsequent tests.
      vi.mocked(runClaudePipe).mockImplementation(async function* () {
        yield { type: "text_delta" as const, text: "done" };
        yield { type: "session_end" as const, reason: "completed" as const };
      });

      const result = await spawnAgentTool.execute(
        { prompt: "background task", background: true },
        mockContext,
      );

      expect(result.isError).toBe(false);
      const parsed = JSON.parse(result.output);
      expect(parsed.taskId).toMatch(/^agent-\d+-\d+$/);
      expect(parsed.status).toBe("backgrounded");
    });

    it("background taskId starts with 'agent-'", async () => {
      vi.mocked(runClaudePipe).mockImplementation(async function* () {
        yield { type: "session_end" as const, reason: "completed" as const };
      });

      const result = await spawnAgentTool.execute(
        { prompt: "bg", background: true },
        mockContext,
      );

      const { taskId } = JSON.parse(result.output);
      expect(taskId.startsWith("agent-")).toBe(true);
    });
  });

  // ── Concurrent limit enforcement ────────────────────────────────────────────
  describe("concurrent sub-agent limit", () => {
    it("enforces max 3 concurrent sub-agents", async () => {
      // Three slow foreground-style tasks that never resolve (background=false
      // uses the same slot tracking). Use background=true which adds to the Map
      // without awaiting, making it easy to fill slots without blocking.
      vi.mocked(runClaudePipe).mockImplementation(async function* () {
        await new Promise(() => {}); // never resolves
        yield { type: "session_end" as const, reason: "completed" as const };
      });

      // Fill all 3 slots with background agents
      const r1 = await spawnAgentTool.execute(
        { prompt: "task 1", background: true },
        mockContext,
      );
      const r2 = await spawnAgentTool.execute(
        { prompt: "task 2", background: true },
        mockContext,
      );
      const r3 = await spawnAgentTool.execute(
        { prompt: "task 3", background: true },
        mockContext,
      );

      expect(r1.isError).toBe(false);
      expect(r2.isError).toBe(false);
      expect(r3.isError).toBe(false);

      // 4th attempt should be rejected
      const r4 = await spawnAgentTool.execute(
        { prompt: "task 4", background: true },
        mockContext,
      );

      expect(r4.isError).toBe(true);
      expect(r4.output).toBe("max concurrent sub-agents (3) reached");
    });
  });
});
