import { describe, it, expect } from "vitest";
import { checkSessionHealth } from "../../../src/core/health-monitor.js";
import type { SessionHealth } from "../../../src/core/health-monitor.js";

function makeSession(overrides: Partial<SessionHealth> = {}): SessionHealth {
  return {
    sessionId: "sess-1",
    lastOutputAt: new Date(),
    mode: "engine",
    tokensUsed: 1000,
    tokenBudget: 10000,
    workspacePath: "/tmp/ws",
    ...overrides,
  };
}

describe("health-monitor", () => {
  it("healthy session returns continue", () => {
    const result = checkSessionHealth(makeSession());
    expect(result.action).toBe("continue");
    expect(result.sessionId).toBe("sess-1");
  });

  it("engine stalled over 60s returns kill", () => {
    const lastOutputAt = new Date(Date.now() - 61_000);
    const result = checkSessionHealth(
      makeSession({ mode: "engine", lastOutputAt }),
    );
    expect(result.action).toBe("kill");
    expect(result.reason).toMatch(/stall/i);
  });

  it("delegate stalled over 300s returns kill", () => {
    const lastOutputAt = new Date(Date.now() - 301_000);
    const result = checkSessionHealth(
      makeSession({ mode: "delegate", lastOutputAt }),
    );
    expect(result.action).toBe("kill");
    expect(result.reason).toMatch(/stall/i);
  });

  it("token budget over 85% returns checkpoint", () => {
    const result = checkSessionHealth(
      makeSession({ tokensUsed: 8600, tokenBudget: 10000 }),
    );
    expect(result.action).toBe("checkpoint");
    expect(result.reason).toMatch(/token/i);
  });

  it("engine with 30s since last output returns continue", () => {
    const lastOutputAt = new Date(Date.now() - 30_000);
    const result = checkSessionHealth(
      makeSession({ mode: "engine", lastOutputAt }),
    );
    expect(result.action).toBe("continue");
  });
});
