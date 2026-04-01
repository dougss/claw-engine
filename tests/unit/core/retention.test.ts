import { describe, it, expect } from "vitest";
import {
  classifyEventsForDeletion,
  type TelemetryEventRow,
} from "../../../src/core/retention.js";

describe("retention policy", () => {
  const now = new Date("2026-04-01T00:00:00Z");

  function daysAgo(days: number): Date {
    return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  }

  it("marks heartbeat events older than 14 days for deletion", () => {
    const events: TelemetryEventRow[] = [
      {
        id: "1",
        eventType: "heartbeat",
        createdAt: daysAgo(15),
        taskId: "t1",
      },
      {
        id: "2",
        eventType: "heartbeat",
        createdAt: daysAgo(10),
        taskId: "t1",
      },
    ];

    const { toDelete } = classifyEventsForDeletion(events, now, {
      heartbeatRetentionDays: 14,
      eventRetentionDays: 90,
    });

    expect(toDelete).toContain("1"); // 15 days > 14 days threshold
    expect(toDelete).not.toContain("2"); // 10 days < 14 days threshold
  });

  it("marks tool call events older than 90 days for deletion", () => {
    const events: TelemetryEventRow[] = [
      { id: "3", eventType: "tool_call", createdAt: daysAgo(91), taskId: "t1" },
      { id: "4", eventType: "tool_call", createdAt: daysAgo(89), taskId: "t1" },
    ];

    const { toDelete } = classifyEventsForDeletion(events, now, {
      heartbeatRetentionDays: 14,
      eventRetentionDays: 90,
    });

    expect(toDelete).toContain("3");
    expect(toDelete).not.toContain("4");
  });

  it("preserves cost_snapshot events regardless of age", () => {
    const events: TelemetryEventRow[] = [
      {
        id: "5",
        eventType: "cost_snapshot",
        createdAt: daysAgo(200),
        taskId: "t1",
      },
    ];

    const { toDelete } = classifyEventsForDeletion(events, now, {
      heartbeatRetentionDays: 14,
      eventRetentionDays: 90,
    });

    expect(toDelete).not.toContain("5");
  });

  it("returns preserved count correctly", () => {
    const events: TelemetryEventRow[] = [
      { id: "a", eventType: "heartbeat", createdAt: daysAgo(20), taskId: "t1" },
      { id: "b", eventType: "heartbeat", createdAt: daysAgo(5), taskId: "t1" },
      {
        id: "c",
        eventType: "cost_snapshot",
        createdAt: daysAgo(100),
        taskId: "t1",
      },
    ];

    const { toDelete, preserved } = classifyEventsForDeletion(events, now, {
      heartbeatRetentionDays: 14,
      eventRetentionDays: 90,
    });

    expect(toDelete).toEqual(["a"]);
    expect(preserved).toBe(2); // b + c
  });
});
