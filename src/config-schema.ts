import { z } from "zod";

const rateLimitSchema = z.object({
  max_requests_per_minute: z.number().int().positive(),
});

const modelTierSchema = z.object({
  model: z.string(),
  provider: z.union([
    z.literal("alibaba"),
    z.literal("anthropic"),
    z.literal("google"),
    z.literal("openai"),
    z.literal("opencode"),
    z.literal("local"),
  ]),
  mode: z.union([z.literal("engine"), z.literal("delegate")]),
  max_retries: z.number().int().nonnegative().default(2),
});

const validationStepSchema = z.object({
  name: z.string(),
  command: z.string(),
  required: z.boolean(),
  retryable: z.boolean(),
});

const validationGroupSchema = z.object({
  parallel: z.boolean().default(false),
  steps: z.array(validationStepSchema),
});

const mcpServerSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).optional(),
  permissions: z
    .union([
      z.literal("allow"),
      z.literal("deny"),
      z.literal("prompt"),
      z.record(
        z.union([z.literal("allow"), z.literal("deny"), z.literal("prompt")]),
      ),
    ])
    .default("prompt"),
});

export const configSchema = z.object({
  engine: z.object({
    name: z.string().default("Claw Engine"),
    port: z.number().int().default(3004),
    host: z.string().default("0.0.0.0"),
    worktrees_dir: z.string().default("~/server/.worktrees"),
  }),

  database: z.object({
    host: z.string().default("127.0.0.1"),
    port: z.number().int().default(5432),
    database: z.string().default("claw_engine"),
    user: z.string().default("claw_engine"),
    password_env: z.string().default("CLAW_ENGINE_DB_PASS"),
  }),

  redis: z.object({
    host: z.string().default("127.0.0.1"),
    port: z.number().int().default(6379),
  }),

  sessions: z.object({
    max_parallel: z.number().int().default(3),
    max_parallel_engine: z.number().int().default(3),
    max_parallel_delegate: z.number().int().default(1),
    health_check_interval_ms: z.number().int().default(30_000),
    stall_timeout_engine_ms: z.number().int().default(60_000),
    stall_timeout_delegate_ms: z.number().int().default(300_000),
  }),

  token_budget: z.object({
    warning_threshold: z.number().default(0.75),
    checkpoint_threshold: z.number().default(0.85),
    reserve_for_summary: z.number().int().default(10_000),
  }),

  models: z.object({
    default: z.string().default("qwen3.5-plus"),
    fallback_chain: z.array(modelTierSchema),
  }),

  providers: z.object({
    alibaba: z.object({
      api_key_env: z.string().default("DASHSCOPE_API_KEY"),
      base_url: z
        .string()
        .default("https://dashscope.aliyuncs.com/compatible-mode/v1"),
      rate_limit: rateLimitSchema.default({ max_requests_per_minute: 8 }),
    }),
    anthropic: z.object({
      binary: z.string().default("claude"),
      flags: z
        .array(z.string())
        .default(["-p", "--output-format", "stream-json"]),
      estimated_daily_limit: z.number().int().default(500_000),
      warning_percent: z.number().default(0.7),
      force_qwen_percent: z.number().default(0.85),
      cache_prompt: z.boolean().default(true),
    }),
    opencode: z
      .object({
        binary: z.string().default("opencode"),
        default_model: z.string().optional(),
      })
      .default({}),
  }),

  validation: z.object({
    max_retries: z.number().int().default(2),
    max_error_context_chars: z.number().int().default(2000),
    typescript: validationGroupSchema.default({
      parallel: false,
      steps: [
        {
          name: "typecheck",
          command: "npx tsc --noEmit",
          required: true,
          retryable: true,
        },
        {
          name: "lint",
          command: "npm run lint",
          required: false,
          retryable: true,
        },
        { name: "test", command: "npm test", required: true, retryable: true },
      ],
    }),
    python: validationGroupSchema.default({
      parallel: false,
      steps: [
        {
          name: "typecheck",
          command: "mypy .",
          required: false,
          retryable: true,
        },
        {
          name: "lint",
          command: "ruff check .",
          required: false,
          retryable: true,
        },
        { name: "test", command: "pytest", required: true, retryable: true },
      ],
    }),
  }),

  mcp: z
    .object({
      inherit_from: z.string().optional(),
      servers: z.record(mcpServerSchema).default({}),
    })
    .default({}),

  notifications: z
    .object({
      telegram: z
        .object({
          enabled: z.boolean().default(true),
          via_openclaw: z.boolean().default(true),
        })
        .default({}),
    })
    .default({}),

  cleanup: z
    .object({
      telemetry_heartbeat_retention_days: z.number().int().default(14),
      telemetry_events_retention_days: z.number().int().default(90),
      worktree_cleanup_after_pr_merge: z.boolean().default(true),
      orphan_worktree_cleanup_on_startup: z.boolean().default(true),
    })
    .default({}),

  github: z
    .object({
      token_env: z.string().default("GITHUB_TOKEN"),
      default_org: z.string().default("dougss"),
      auto_create_pr: z.boolean().default(true),
    })
    .default({}),
});

export type ClawEngineConfig = z.infer<typeof configSchema>;
