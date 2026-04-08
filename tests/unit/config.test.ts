import { describe, expect, it } from "vitest";
import { configSchema } from "../../src/config-schema.js";

describe("configSchema", () => {
  it("parses a complete config", () => {
    const input = {
      engine: {
        name: "Test",
        port: 3004,
        host: "0.0.0.0",
        worktrees_dir: "/tmp/wt",
      },
      database: {
        host: "localhost",
        port: 5432,
        database: "test",
        user: "test",
        password_env: "DB_PASS",
      },
      redis: { host: "localhost", port: 6379 },
      sessions: {
        max_parallel: 2,
        max_parallel_engine: 2,
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
        default: "qwen3.5-plus",
        fallback_chain: [
          {
            model: "qwen3.5-plus",
            provider: "alibaba",
            mode: "engine",
            max_retries: 2,
          },
        ],
      },
      providers: {
        alibaba: {
          api_key_env: "KEY",
          base_url: "https://example.com",
          rate_limit: { max_requests_per_minute: 8 },
        },
        anthropic: {
          binary: "claude",
          flags: ["-p"],
          estimated_daily_limit: 500000,
          warning_percent: 0.7,
          force_qwen_percent: 0.85,
        },
      },
      router: { complexity_signals: { refactor: 3, crud: -2 } },
      validation: { max_retries: 2, typescript: { parallel: false, steps: [] }, python: { parallel: false, steps: [] } },
    };

    const result = configSchema.parse(input);
    expect(result.engine.port).toBe(3004);
    expect(result.models.fallback_chain).toHaveLength(1);
  });

  it("applies defaults for optional sections", () => {
    const minimal = {
      engine: {
        name: "Test",
        port: 3004,
        host: "0.0.0.0",
        worktrees_dir: "/tmp",
      },
      database: {
        host: "localhost",
        port: 5432,
        database: "test",
        user: "test",
        password_env: "P",
      },
      redis: { host: "localhost", port: 6379 },
      sessions: {
        max_parallel: 1,
        max_parallel_engine: 1,
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
      models: { default: "qwen3.5-plus", fallback_chain: [] },
      providers: {
        alibaba: {
          api_key_env: "K",
          base_url: "https://x.com",
          rate_limit: { max_requests_per_minute: 5 },
        },
        anthropic: {
          binary: "claude",
          flags: [],
          estimated_daily_limit: 100000,
          warning_percent: 0.7,
          force_qwen_percent: 0.85,
        },
      },
      router: { complexity_signals: {} },
      validation: { max_retries: 2, typescript: { parallel: false, steps: [] }, python: { parallel: false, steps: [] } },
    };

    const result = configSchema.parse(minimal);
    expect(result.cleanup.telemetry_heartbeat_retention_days).toBe(14);
    expect(result.mcp.servers).toEqual({});
    expect(result.github.auto_create_pr).toBe(true);
    expect(result.notifications.telegram.enabled).toBe(true);
  });

  it("rejects invalid provider", () => {
    const bad = {
      engine: { name: "T", port: 3004, host: "0.0.0.0", worktrees_dir: "/tmp" },
      database: {
        host: "h",
        port: 5432,
        database: "d",
        user: "u",
        password_env: "P",
      },
      redis: { host: "h", port: 6379 },
      sessions: {
        max_parallel: 1,
        max_parallel_engine: 1,
        max_parallel_delegate: 1,
        health_check_interval_ms: 1,
        stall_timeout_engine_ms: 1,
        stall_timeout_delegate_ms: 1,
      },
      token_budget: {
        warning_threshold: 0.75,
        checkpoint_threshold: 0.85,
        reserve_for_summary: 10000,
      },
      models: {
        default: "qwen",
        fallback_chain: [
          { model: "qwen", provider: "invalid_provider", mode: "engine" },
        ],
      },
      providers: {
        alibaba: {
          api_key_env: "K",
          base_url: "u",
          rate_limit: { max_requests_per_minute: 1 },
        },
        anthropic: {
          binary: "c",
          flags: [],
          estimated_daily_limit: 1,
          warning_percent: 0.7,
          force_qwen_percent: 0.85,
        },
      },
      router: { complexity_signals: {} },
      validation: { max_retries: 2, typescript: { parallel: false, steps: [] }, python: { parallel: false, steps: [] } },
    };

    expect(() => configSchema.parse(bad)).toThrow();
  });
});
