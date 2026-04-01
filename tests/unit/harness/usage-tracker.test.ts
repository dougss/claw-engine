import { describe, it, expect } from "vitest";
import { createUsageTracker } from "../../../src/harness/usage-tracker.js";

describe("UsageTracker", () => {
  it("starts with zeroes", () => {
    const tracker = createUsageTracker();
    const summary = tracker.getSummary();
    expect(summary.totalInputTokens).toBe(0);
    expect(summary.totalOutputTokens).toBe(0);
    expect(summary.turnCount).toBe(0);
    expect(summary.toolCallCount).toBe(0);
    expect(summary.permissionDenialCount).toBe(0);
  });

  it("addTurn accumulates tokens and increments turnCount", () => {
    const tracker = createUsageTracker();
    tracker.addTurn({ inputTokens: 100, outputTokens: 50 });
    tracker.addTurn({ inputTokens: 200, outputTokens: 80 });
    const summary = tracker.getSummary();
    expect(summary.totalInputTokens).toBe(300);
    expect(summary.totalOutputTokens).toBe(130);
    expect(summary.turnCount).toBe(2);
  });

  it("addToolCall increments tool count", () => {
    const tracker = createUsageTracker();
    tracker.addToolCall();
    tracker.addToolCall();
    tracker.addToolCall();
    expect(tracker.getSummary().toolCallCount).toBe(3);
  });

  it("addPermissionDenial increments denial count", () => {
    const tracker = createUsageTracker();
    tracker.addPermissionDenial();
    expect(tracker.getSummary().permissionDenialCount).toBe(1);
  });

  it("currentPercent computes usage percentage from latest token_update", () => {
    const tracker = createUsageTracker();
    tracker.updateTokenPercent(65);
    expect(tracker.currentPercent).toBe(65);
    tracker.updateTokenPercent(72);
    expect(tracker.currentPercent).toBe(72);
  });

  it("toSerializable roundtrips through fromSerializable", () => {
    const tracker = createUsageTracker();
    tracker.addTurn({ inputTokens: 500, outputTokens: 200 });
    tracker.addToolCall();
    tracker.addPermissionDenial();
    tracker.updateTokenPercent(40);

    const serialized = tracker.toSerializable();
    const restored = createUsageTracker({ fromSerialized: serialized });
    expect(restored.getSummary()).toEqual(tracker.getSummary());
    expect(restored.currentPercent).toBe(40);
  });
});
