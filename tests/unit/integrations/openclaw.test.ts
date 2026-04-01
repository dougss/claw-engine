import { describe, it, expect } from "vitest";
import {
  sendAlert,
  shouldSendAlert,
} from "../../../src/integrations/openclaw/client.js";

describe("OpenClaw alerts", () => {
  it("shouldSendAlert respects cooldown", () => {
    const lastSent = Date.now() - 30_000; // 30 seconds ago
    const cooldownMs = 60_000; // 60 second cooldown
    expect(shouldSendAlert({ lastSentMs: lastSent, cooldownMs })).toBe(false);
  });

  it("shouldSendAlert allows sending after cooldown", () => {
    const lastSent = Date.now() - 120_000; // 2 minutes ago
    const cooldownMs = 60_000;
    expect(shouldSendAlert({ lastSentMs: lastSent, cooldownMs })).toBe(true);
  });

  it("shouldSendAlert allows first send (no previous)", () => {
    expect(shouldSendAlert({ lastSentMs: null, cooldownMs: 60_000 })).toBe(
      true,
    );
  });

  it("exports sendAlert function", () => {
    expect(typeof sendAlert).toBe("function");
  });
});
