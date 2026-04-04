import { describe, it, expect } from "vitest";
import { buildFollowUpPrompt } from "../../../../src/cli/chat/context-builder.js";
import type { ChatSession } from "../../../../src/cli/chat/session.js";
import { createSession, addTurn } from "../../../../src/cli/chat/session.js";

describe("context-builder", () => {
  it("returns raw prompt when no previous turns", () => {
    const s = createSession({
      repoPath: "/repo",
      complexity: "medium",
      provider: "opencode",
      model: "m",
    });
    const result = buildFollowUpPrompt(s, "fix the bug");
    expect(result).toBe("fix the bug");
  });

  it("includes previous turn context for follow-ups", () => {
    const s = createSession({
      repoPath: "/repo",
      complexity: "medium",
      provider: "opencode",
      model: "m",
    });
    addTurn(s, {
      prompt: "implement auth system",
      tokensUsed: 5000,
      endReason: "completed",
    });
    const result = buildFollowUpPrompt(s, "now add tests");
    expect(result).toContain("implement auth system");
    expect(result).toContain("now add tests");
    expect(result).toContain("CONTEXT");
  });

  it("limits context to last 5 turns", () => {
    const s = createSession({
      repoPath: "/repo",
      complexity: "medium",
      provider: "opencode",
      model: "m",
    });
    for (let i = 0; i < 8; i++) {
      addTurn(s, {
        prompt: `turn ${i}`,
        tokensUsed: 100,
        endReason: "completed",
      });
    }
    const result = buildFollowUpPrompt(s, "next task");
    
    // The "Original task" line always shows the first turn (turn 0), which is expected behavior
    expect(result).toContain("Original task: \"turn 0\"");
    
    // The "Previous turns" section should only contain the last 5 turns (indices 3-7: "turn 3", "turn 4", "turn 5", "turn 6", "turn 7")
    // So it should NOT contain the older turns in the numbered list (turn 0, turn 1, turn 2)
    expect(result).toContain("turn 3");  // Most recent 5th turn
    expect(result).toContain("turn 7");  // Most recent turn
    // Check that older turns (0,1,2) don't appear in the numbered "Previous turns" list
    // By looking for the pattern "N. \"turn X\" — completed" where X is 0, 1, or 2 (but excluding the "Original task" line)
    const olderTurnsInContext = result.includes('1. "turn 0"') || result.includes('2. "turn 0"') ||
                                result.includes('1. "turn 1"') || result.includes('2. "turn 1"') ||
                                result.includes('1. "turn 2"') || result.includes('2. "turn 2"');
    expect(olderTurnsInContext).toBe(false);
  });
});