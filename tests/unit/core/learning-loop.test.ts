import { describe, it, expect } from "vitest";
import {
  computeSuccessRates,
  buildScoreAdjustments,
  type RoutingRecord,
} from "../../../src/core/learning-loop.js";

describe("learning-loop", () => {
  it("computes success rates per pattern+model", () => {
    const records: RoutingRecord[] = [
      { taskPattern: "crud", model: "qwen3.5-plus", success: true },
      { taskPattern: "crud", model: "qwen3.5-plus", success: true },
      { taskPattern: "crud", model: "qwen3.5-plus", success: true },
      { taskPattern: "crud", model: "claude-sonnet-4-5", success: false },
      { taskPattern: "crud", model: "qwen3.5-plus", success: false },
    ];

    const rates = computeSuccessRates(records);
    expect(rates.get("crud:qwen3.5-plus")).toBeCloseTo(0.75); // 3/4
    expect(rates.get("crud:claude-sonnet-4-5")).toBeCloseTo(0.0); // 0/1
  });

  it("builds positive score adjustment when non-default outperforms default", () => {
    const rates = new Map([
      ["refactor:qwen3.5-plus", 0.4], // default model, low success
      ["refactor:claude-sonnet-4-5", 0.9], // claude does better
    ]);

    const adjustments = buildScoreAdjustments(rates, "qwen3.5-plus");

    // claude should get a bonus for refactor
    expect(adjustments.get("refactor:claude-sonnet-4-5")).toBeGreaterThan(0);
    // default model gets penalty / no bonus
    expect(adjustments.get("refactor:qwen3.5-plus") ?? 0).toBeLessThanOrEqual(
      0,
    );
  });

  it("returns empty adjustments when sample size too small", () => {
    const records: RoutingRecord[] = [
      { taskPattern: "auth", model: "qwen3.5-plus", success: true },
    ];

    const rates = computeSuccessRates(records);
    // Only 1 sample — not enough to adjust
    const adjustments = buildScoreAdjustments(rates, "qwen3.5-plus", {
      minSamples: 5,
    });
    expect(adjustments.size).toBe(0);
  });

  it("does not penalize default model when it outperforms alternatives", () => {
    const rates = new Map([
      ["test:qwen3.5-plus", 0.95],
      ["test:claude-sonnet-4-5", 0.5],
    ]);

    const adjustments = buildScoreAdjustments(rates, "qwen3.5-plus");
    // default wins, no adjustments needed
    const claudeAdj = adjustments.get("test:claude-sonnet-4-5") ?? 0;
    expect(claudeAdj).toBeLessThanOrEqual(0);
  });
});
