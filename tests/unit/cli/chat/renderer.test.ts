import { describe, it, expect } from "vitest";
import {
  formatToolUse,
  formatTokenSummary,
  formatPhaseStart,
  formatPhaseEnd,
  formatStatusLine,
  COLORS,
} from "../../../../src/cli/chat/renderer.js";

describe("renderer", () => {
  it("formatToolUse shows tool name and truncated input", () => {
    const line = formatToolUse("Read", {
      file_path: "/very/long/path/to/file.ts",
    });
    expect(line).toContain("Read");
    expect(line).toContain("file_path");
  });

  it("formatTokenSummary shows used tokens", () => {
    const line = formatTokenSummary(15000, 200000);
    expect(line).toContain("15,000");
  });

  it("formatPhaseStart shows phase name", () => {
    const line = formatPhaseStart("execute", 1);
    expect(line).toContain("EXECUTE");
  });

  it("formatPhaseEnd shows success/fail icon", () => {
    const pass = formatPhaseEnd("validate", true, 1200);
    expect(pass).toContain("VALIDATE");
    const fail = formatPhaseEnd("validate", false, 500);
    expect(fail).toContain("VALIDATE");
  });

  it("formatStatusLine shows model and tokens", () => {
    const line = formatStatusLine({
      model: "qwen3-coder-plus",
      tokens: 5000,
      complexity: "medium",
      sessionId: "abc-123",
      turn: 3,
    });
    expect(line).toContain("qwen3-coder-plus");
    expect(line).toContain("5,000");
    expect(line).toContain("medium");
  });
});