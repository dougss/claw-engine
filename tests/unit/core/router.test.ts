import { describe, it, expect } from "vitest";
import { routeTask } from "../../../src/core/router.js";
import type { ClawEngineConfig } from "../../../src/config-schema.js";

const testConfig: ClawEngineConfig = {
  engine: { name: "test", port: 3004, host: "0.0.0.0", worktrees_dir: "/tmp" },
  database: {
    host: "127.0.0.1",
    port: 5432,
    database: "claw_engine",
    user: "claw_engine",
    password_env: "X",
  },
  redis: { host: "127.0.0.1", port: 6379 },
  sessions: {
    max_parallel: 3,
    max_parallel_engine: 3,
    max_parallel_delegate: 1,
    health_check_interval_ms: 30000,
    stall_timeout_engine_ms: 60000,
    stall_timeout_delegate_ms: 300000,
  },
  token_budget: {
    warning_threshold: 0.75,
    checkpoint_threshold: 0.85,
    reserve_for_summary: 10000,
  },
  models: {
    default: "qwen-turbo",
    fallback_chain: [
      {
        model: "qwen-turbo",
        provider: "alibaba",
        mode: "engine",
        max_retries: 2,
      },
      {
        model: "claude-sonnet-4-5",
        provider: "anthropic",
        mode: "delegate",
        max_retries: 1,
      },
    ],
  },
  providers: {
    alibaba: {
      api_key_env: "DASHSCOPE_API_KEY",
      base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      rate_limit: { max_requests_per_minute: 8 },
    },
    anthropic: {
      binary: "claude",
      flags: ["-p", "--output-format", "stream-json"],
      estimated_daily_limit: 500000,
      warning_percent: 0.7,
      force_qwen_percent: 0.85,
    },
  },
  validation: { max_retries: 2, typescript: [], python: [] },
  mcp: { servers: {} },
  notifications: { telegram: { enabled: true, via_openclaw: true } },
  cleanup: {
    telemetry_heartbeat_retention_days: 14,
    telemetry_events_retention_days: 90,
    worktree_cleanup_after_pr_merge: true,
    orphan_worktree_cleanup_on_startup: true,
  },
  github: {
    token_env: "GITHUB_TOKEN",
    default_org: "dougss",
    auto_create_pr: true,
  },
};

describe("routeTask", () => {
  it("simple complexity → alibaba engine mode", () => {
    const result = routeTask(
      {
        complexity: "simple",
        description: "add a button",
        fallbackChainPosition: 0,
        claudeBudgetPercent: 0,
      },
      testConfig,
    );
    expect(result.provider).toBe("alibaba");
    expect(result.mode).toBe("engine");
  });

  it("medium complexity → alibaba engine mode", () => {
    const result = routeTask(
      {
        complexity: "medium",
        description: "add a feature with some logic",
        fallbackChainPosition: 0,
        claudeBudgetPercent: 0,
      },
      testConfig,
    );
    expect(result.provider).toBe("alibaba");
    expect(result.mode).toBe("engine");
  });

  it("complex complexity → anthropic delegate mode", () => {
    const result = routeTask(
      {
        complexity: "complex",
        description: "complex architecture change",
        fallbackChainPosition: 0,
        claudeBudgetPercent: 0,
      },
      testConfig,
    );
    expect(result.provider).toBe("anthropic");
    expect(result.mode).toBe("delegate");
  });

  it("fallbackChainPosition: 1 → delegates to chain[1]", () => {
    const result = routeTask(
      {
        complexity: "simple",
        description: "anything",
        fallbackChainPosition: 1,
        claudeBudgetPercent: 0,
      },
      testConfig,
    );
    expect(result.model).toBe("claude-sonnet-4-5");
    expect(result.provider).toBe("anthropic");
  });

  it("claudeBudgetPercent: 90 (>= 85%) → forces alibaba even for complex tasks", () => {
    const result = routeTask(
      {
        complexity: "complex",
        description: "complex task",
        fallbackChainPosition: 0,
        claudeBudgetPercent: 90,
      },
      testConfig,
    );
    expect(result.provider).toBe("alibaba");
    expect(result.reason).toContain("claude budget exceeded");
  });
});
