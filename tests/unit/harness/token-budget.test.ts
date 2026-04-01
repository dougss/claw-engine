import { describe, expect, it } from "vitest";
import {
  createTokenBudget,
  estimateTokens,
  shouldCheckpoint,
  shouldWarn,
  trackTokens,
} from "../../../src/harness/token-budget.js";

describe("token budget", () => {
  it("estimateTokens uses ceil(len/4)+1 heuristic", () => {
    expect(estimateTokens("")).toBe(1);
    expect(estimateTokens("a")).toBe(2);
    expect(estimateTokens("abcd")).toBe(2);
    expect(estimateTokens("abcde")).toBe(3);
  });

  it("warns at 75% of usable context", () => {
    const budget = createTokenBudget({
      maxContext: 100,
      warningThreshold: 0.75,
      checkpointThreshold: 0.85,
      reserveForSummary: 0,
    });

    expect(
      shouldWarn(
        trackTokens(budget, { systemPromptTokens: 0, messagesTokens: 74 }),
      ),
    ).toBe(false);
    expect(
      shouldWarn(
        trackTokens(budget, { systemPromptTokens: 0, messagesTokens: 75 }),
      ),
    ).toBe(true);
  });

  it("checkpoints at 85% of usable context", () => {
    const budget = createTokenBudget({
      maxContext: 100,
      warningThreshold: 0.75,
      checkpointThreshold: 0.85,
      reserveForSummary: 0,
    });

    expect(
      shouldCheckpoint(
        trackTokens(budget, { systemPromptTokens: 0, messagesTokens: 84 }),
      ),
    ).toBe(false);
    expect(
      shouldCheckpoint(
        trackTokens(budget, { systemPromptTokens: 0, messagesTokens: 85 }),
      ),
    ).toBe(true);
  });

  it("applies reserveForSummary before thresholds", () => {
    const budget = createTokenBudget({
      maxContext: 100,
      warningThreshold: 0.75,
      checkpointThreshold: 0.85,
      reserveForSummary: 20,
    });

    expect(budget.warningAt).toBe(60);
    expect(budget.checkpointAt).toBe(68);
  });
});
