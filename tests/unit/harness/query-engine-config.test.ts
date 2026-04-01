import { describe, it, expect } from "vitest";
import {
  createQueryEngineConfig,
  DEFAULT_QUERY_ENGINE_CONFIG,
  TOOL_PROFILE,
  TOKEN_BUDGET_MODE,
} from "../../../src/harness/query-engine-config.js";

describe("QueryEngineConfig", () => {
  it("creates config with all defaults", () => {
    const config = createQueryEngineConfig({});
    expect(config.maxTurns).toBe(DEFAULT_QUERY_ENGINE_CONFIG.maxTurns);
    expect(config.maxTokens).toBe(DEFAULT_QUERY_ENGINE_CONFIG.maxTokens);
    expect(config.tokenBudgetMode).toBe(TOKEN_BUDGET_MODE.adaptive);
    expect(config.warningThreshold).toBe(0.75);
    expect(config.checkpointThreshold).toBe(0.85);
    expect(config.compactionThreshold).toBe(0.7);
    expect(config.compactionPreserveMessages).toBe(4);
    expect(config.compactionEnabled).toBe(true);
    expect(config.toolProfile).toBe(TOOL_PROFILE.full);
    expect(config.reserveForSummary).toBe(10_000);
  });

  it("overrides specific fields while keeping other defaults", () => {
    const config = createQueryEngineConfig({
      maxTurns: 50,
      toolProfile: TOOL_PROFILE.readonly,
      compactionEnabled: false,
    });
    expect(config.maxTurns).toBe(50);
    expect(config.toolProfile).toBe(TOOL_PROFILE.readonly);
    expect(config.compactionEnabled).toBe(false);
    expect(config.maxTokens).toBe(DEFAULT_QUERY_ENGINE_CONFIG.maxTokens);
  });

  it("rejects compactionThreshold >= checkpointThreshold", () => {
    expect(() =>
      createQueryEngineConfig({
        compactionThreshold: 0.9,
        checkpointThreshold: 0.85,
      }),
    ).toThrow("compactionThreshold must be less than checkpointThreshold");
  });

  it("rejects maxTurns <= 0", () => {
    expect(() => createQueryEngineConfig({ maxTurns: 0 })).toThrow(
      "maxTurns must be positive",
    );
  });

  it("rejects maxTokens <= 0", () => {
    expect(() => createQueryEngineConfig({ maxTokens: -1 })).toThrow(
      "maxTokens must be positive",
    );
  });

  it("allows custom tool profile with allowedTools", () => {
    const config = createQueryEngineConfig({
      toolProfile: TOOL_PROFILE.custom,
      allowedTools: ["read_file", "grep"],
    });
    expect(config.toolProfile).toBe(TOOL_PROFILE.custom);
    expect(config.allowedTools).toEqual(["read_file", "grep"]);
  });

  it("rejects custom profile without allowedTools", () => {
    expect(() =>
      createQueryEngineConfig({
        toolProfile: TOOL_PROFILE.custom,
      }),
    ).toThrow("allowedTools required when toolProfile is 'custom'");
  });
});
