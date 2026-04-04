import { describe, it, expect } from "vitest";
import {
  createSession,
  addTurn,
  getTurnSummary,
  type ChatSession,
} from "../../../../src/cli/chat/session.js";

describe("ChatSession", () => {
  it("creates a session with defaults", () => {
    const s = createSession({
      repoPath: "/tmp/repo",
      complexity: "medium",
      provider: "opencode",
      model: "qwen3-coder-plus",
    });
    expect(s.id).toBeTruthy();
    expect(s.turns).toEqual([]);
    expect(s.totalTokens).toBe(0);
    expect(s.branch).toBeNull();
    expect(s.flags.forcePipeline).toBe(false);
    expect(s.flags.forceDelegate).toBe(false);
  });

  it("adds a turn and accumulates tokens", () => {
    const s = createSession({
      repoPath: "/tmp/repo",
      complexity: "simple",
      provider: "opencode",
      model: "m",
    });
    addTurn(s, { prompt: "fix bug", tokensUsed: 500, endReason: "completed" });
    expect(s.turns).toHaveLength(1);
    expect(s.totalTokens).toBe(500);
    addTurn(s, {
      prompt: "also this",
      tokensUsed: 300,
      endReason: "completed",
    });
    expect(s.totalTokens).toBe(800);
  });

  it("getTurnSummary produces compact summary", () => {
    const s = createSession({
      repoPath: "/tmp/repo",
      complexity: "medium",
      provider: "opencode",
      model: "m",
    });
    addTurn(s, {
      prompt: "implement auth",
      tokensUsed: 1000,
      endReason: "completed",
    });
    addTurn(s, {
      prompt: "add tests",
      tokensUsed: 500,
      endReason: "completed",
    });
    const summary = getTurnSummary(s);
    expect(summary).toContain("implement auth");
    expect(summary).toContain("add tests");
  });
});