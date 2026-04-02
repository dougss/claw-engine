# Claw Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Claw Engine daemon — a model-agnostic coding agent factory that decomposes features into parallelizable DAGs, routes tasks to the cheapest viable model, manages session lifecycles via git worktrees, and exposes CLI + API + dashboard.

**Architecture:** Bottom-up build — database & config first, then harness primitives (tools, permissions, tokens, adapters), then agentic loop, then single-session runner, then multi-session orchestration (decomposer, router, scheduler), then integrations, API/dashboard, and hardening. Each task produces independently testable, committable work.

**Tech Stack:** Node.js 22, TypeScript (ESM, `.js` import extensions), Fastify 5, BullMQ + Redis, PostgreSQL 16 (Drizzle ORM), Commander.js, React 19 + Vite + Tailwind + shadcn/ui + @xyflow/react + Recharts, SSE.

**Port note:** Spec says 3003, but server CLAUDE.md already maps 3003 to Excalidraw Canvas Server. Use **3004** instead. Update `config.yaml` default port and LaunchAgent accordingly. Update server CLAUDE.md in Task 26.

---

## Conventions

- **ESM everywhere**: `"type": "module"` in `package.json`, explicit `.js` extensions on local imports (matches Nexus/Harness patterns).
- **tsconfig**: `module: "ES2022"`, `moduleResolution: "bundler"`, `strict: true`, `outDir: "dist"`, `rootDir: "src"`.
- **Build**: `esbuild` for CLI bundle, `tsc` for type checking; dashboard via Vite.
- **RORO**: Functions with 3+ params receive/return objects.
- **No enums**: Use `const` objects + union types derived via `typeof obj[keyof typeof obj]`.
- **No classes** unless required by library APIs (Fastify, BullMQ).
- **Tests**: Vitest. Unit tests next to source (`tests/unit/`), integration in `tests/integration/`.
- **DB access**: Drizzle ORM with lazy singleton `getDb()` pattern (same as Nexus/Harness).
- **Packages (pin to existing ecosystem)**: `drizzle-orm@^0.39`, `drizzle-kit@^0.30`, `fastify@^5.3`, `@fastify/cors@^11`, `commander@^13`, `pg@^8.13`, `zod@^3.24`, `vitest@^3.0`, `typescript@^5.7`, `tsx@^4.19`, `bullmq@^5` (new), `@modelcontextprotocol/sdk@^1.12`, `fast-glob@^3`, `yaml@^2`.

---

## File structure (locked-in decomposition)

```
~/server/apps/claw-engine/
├── package.json
├── tsconfig.json
├── drizzle.config.ts
├── vitest.config.ts
├── vitest.integration.config.ts
├── config/
│   └── config.yaml              # Runtime config (template, not compiled)
├── src/
│   ├── server.ts                # Fastify HTTP + SSE + static dashboard
│   ├── daemon.ts                # Daemon lifecycle (start/stop/reconcile)
│   ├── types.ts                 # Shared types (HarnessEvent, etc.)
│   ├── config.ts                # Config loader (reads YAML, validates with Zod)
│   ├── config-schema.ts         # Zod schema for config.yaml
│   ├── harness/
│   │   ├── agent-loop.ts        # Agentic loop orchestration
│   │   ├── context-builder.ts   # 6-layer system prompt builder
│   │   ├── token-budget.ts      # Budget tracking + checkpoint trigger
│   │   ├── permissions.ts       # Permission rules + evaluation
│   │   ├── events.ts            # HarnessEvent type + helpers
│   │   ├── tools/
│   │   │   ├── tool-types.ts    # Tool interface + registry
│   │   │   ├── tool-registry.ts # Built-in + MCP tool registry
│   │   │   └── builtins/
│   │   │       ├── bash.ts
│   │   │       ├── read-file.ts
│   │   │       ├── write-file.ts
│   │   │       ├── edit-file.ts
│   │   │       ├── glob-tool.ts
│   │   │       ├── grep-tool.ts
│   │   │       └── ask-user.ts
│   │   ├── model-adapters/
│   │   │   ├── adapter-types.ts   # ModelAdapter interface
│   │   │   ├── mock-adapter.ts    # Scripted responses for tests
│   │   │   ├── alibaba-adapter.ts # DashScope (Qwen, DeepSeek, Kimi)
│   │   │   └── claude-pipe-adapter.ts # claude -p subprocess
│   │   └── recordings/
│   │       ├── recording-format.ts
│   │       ├── recorder.ts
│   │       └── recorded-adapter.ts
│   ├── core/
│   │   ├── state-machine.ts     # Task/session status transitions
│   │   ├── session-manager.ts   # Single session lifecycle
│   │   ├── scheduler.ts         # BullMQ DAG-aware orchestration
│   │   ├── router.ts            # 3-layer model routing
│   │   ├── decomposer.ts        # Feature → DAG generation
│   │   ├── dag-schema.ts        # Zod schemas for DAG
│   │   ├── error-classifier.ts  # Error classification for escalation
│   │   └── reconcile.ts         # Startup reconciliation
│   ├── integrations/
│   │   ├── git/
│   │   │   └── worktrees.ts     # Git worktree management
│   │   ├── github/
│   │   │   └── client.ts        # Branch + PR creation via gh CLI
│   │   ├── nexus/
│   │   │   └── client.ts        # Skill injection via MCP
│   │   ├── openclaw/
│   │   │   └── client.ts        # Telegram alerts via OpenClaw
│   │   └── mcp/
│   │       ├── mcp-client.ts    # MCP client manager (discover/execute)
│   │       └── schema-translator.ts # MCP→provider tool schema translation
│   ├── storage/
│   │   ├── db.ts                # Drizzle client singleton
│   │   ├── schema/
│   │   │   ├── index.ts         # Re-exports all tables
│   │   │   ├── work-items.ts
│   │   │   ├── tasks.ts
│   │   │   ├── session-telemetry.ts
│   │   │   ├── routing-history.ts
│   │   │   └── cost-snapshots.ts
│   │   └── repositories/
│   │       ├── work-items-repo.ts
│   │       ├── tasks-repo.ts
│   │       ├── telemetry-repo.ts
│   │       ├── routing-repo.ts
│   │       └── cost-repo.ts
│   ├── api/
│   │   ├── routes/
│   │   │   ├── work-items.ts
│   │   │   ├── tasks.ts
│   │   │   ├── sessions.ts
│   │   │   ├── metrics.ts
│   │   │   └── logs.ts
│   │   └── sse.ts               # SSE hub + Redis replay buffer
│   ├── cli/
│   │   ├── index.ts             # Commander.js entry
│   │   └── commands/
│   │       ├── submit.ts
│   │       ├── run.ts
│   │       ├── status.ts
│   │       ├── sessions.ts
│   │       ├── logs.ts
│   │       ├── costs.ts
│   │       ├── router-stats.ts
│   │       ├── cleanup.ts
│   │       ├── doctor.ts
│   │       ├── pause.ts
│   │       ├── resume.ts
│   │       ├── cancel.ts
│   │       ├── retry.ts
│   │       ├── approve.ts
│   │       └── daemon.ts
│   └── dashboard/               # Vite React app
│       ├── index.html
│       ├── vite.config.ts
│       ├── tailwind.config.ts
│       ├── tsconfig.json
│       └── src/
│           ├── main.tsx
│           ├── app.tsx
│           ├── lib/
│           │   ├── api.ts       # REST client
│           │   └── sse.ts       # SSE client with reconnect
│           ├── components/
│           │   ├── layout.tsx
│           │   ├── sidebar.tsx
│           │   └── ui/          # shadcn components
│           └── pages/
│               ├── dag.tsx      # @xyflow/react DAG visualization
│               ├── sessions.tsx # Live session stream
│               ├── metrics.tsx  # Recharts cost/token charts
│               └── logs.tsx     # Filterable log viewer
├── migrations/                  # Drizzle migrations
├── tests/
│   ├── unit/
│   │   ├── harness/
│   │   ├── core/
│   │   ├── tools/
│   │   └── integrations/
│   ├── integration/
│   ├── recordings/              # Recorded sessions for replay
│   ├── fixtures/                # Test repos, sample CLAUDE.md
│   └── e2e/
└── CLAUDE.md                    # Project-specific context
```

---

## Task 1: Repository scaffold + config + database

**Files:**

- Create: `~/server/apps/claw-engine/package.json`
- Create: `~/server/apps/claw-engine/tsconfig.json`
- Create: `~/server/apps/claw-engine/vitest.config.ts`
- Create: `~/server/apps/claw-engine/drizzle.config.ts`
- Create: `~/server/apps/claw-engine/src/config-schema.ts`
- Create: `~/server/apps/claw-engine/src/config.ts`
- Create: `~/server/apps/claw-engine/config/config.yaml`
- Create: `~/server/apps/claw-engine/src/storage/db.ts`
- Create: `~/server/apps/claw-engine/src/storage/schema/*.ts`
- Create: `~/server/apps/claw-engine/vitest.integration.config.ts`
- Test: `~/server/apps/claw-engine/tests/unit/config.test.ts`

- [ ] **Step 1: Create directory and `package.json`**

```bash
mkdir -p ~/server/apps/claw-engine
cd ~/server/apps/claw-engine
```

```json
{
  "name": "claw-engine",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/server.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:integration": "vitest run --config vitest.integration.config.ts",
    "typecheck": "tsc --noEmit",
    "lint": "echo 'no linter configured yet'",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:studio": "drizzle-kit studio",
    "claw": "tsx src/cli/index.ts"
  },
  "bin": {
    "claw": "./dist/cli/index.js"
  }
}
```

```bash
cd ~/server/apps/claw-engine && npm install drizzle-orm@^0.39 pg@^8.13 zod@^3.24 yaml@^2 fastify@^5.3 @fastify/cors@^11 @fastify/static@^8.1 commander@^13 bullmq@^5 fast-glob@^3 @modelcontextprotocol/sdk@^1.12
npm install -D typescript@^5.7 tsx@^4.19 vitest@^3.0 drizzle-kit@^0.30 @types/pg @types/node esbuild
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "tests", "src/dashboard"]
}
```

- [ ] **Step 3: Create `vitest.config.ts` and `vitest.integration.config.ts`**

`vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    globals: true,
  },
});
```

`vitest.integration.config.ts`:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    globals: true,
    testTimeout: 30000,
    hookTimeout: 15000,
  },
});
```

- [ ] **Step 4: Create config schema (`src/config-schema.ts`)**

```typescript
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
    health_check_interval_ms: z.number().int().default(30000),
    stall_timeout_engine_ms: z.number().int().default(60000),
    stall_timeout_delegate_ms: z.number().int().default(300000),
  }),

  token_budget: z.object({
    warning_threshold: z.number().default(0.75),
    checkpoint_threshold: z.number().default(0.85),
    reserve_for_summary: z.number().int().default(10000),
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
      estimated_daily_limit: z.number().int().default(500000),
      warning_percent: z.number().default(0.7),
      force_qwen_percent: z.number().default(0.85),
    }),
  }),

  router: z.object({
    complexity_signals: z.record(z.number()).default({
      refactor: 3,
      debug: 3,
      investigate: 2,
      architecture: 3,
      "cross-repo": 4,
      migration: 2,
      security: 2,
      crud: -2,
      boilerplate: -3,
      test: -1,
      rename: -2,
      "add field": -2,
      "create endpoint": -1,
    }),
  }),

  validation: z.object({
    max_retries: z.number().int().default(2),
    typescript: z.array(validationStepSchema).default([
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
    ]),
    python: z.array(validationStepSchema).default([
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
    ]),
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
```

- [ ] **Step 5: Create config loader (`src/config.ts`) + YAML template (`config/config.yaml`)**

Write `src/config.ts`:

```typescript
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { configSchema, type ClawEngineConfig } from "./config-schema.js";

export function loadConfig(configPath?: string): ClawEngineConfig {
  const path =
    configPath ?? resolve(import.meta.dirname, "../config/config.yaml");
  const raw = readFileSync(path, "utf-8");
  const parsed = parse(raw);
  return configSchema.parse(parsed);
}
```

Write the default YAML at `config/config.yaml`:

```yaml
engine:
  name: "Claw Engine"
  port: 3004
  host: "0.0.0.0"
  worktrees_dir: "~/server/.worktrees"

database:
  host: "127.0.0.1"
  port: 5432
  database: "claw_engine"
  user: "claw_engine"
  password_env: "CLAW_ENGINE_DB_PASS"

redis:
  host: "127.0.0.1"
  port: 6379

sessions:
  max_parallel: 3
  max_parallel_engine: 3
  max_parallel_delegate: 1
  health_check_interval_ms: 30000
  stall_timeout_engine_ms: 60000
  stall_timeout_delegate_ms: 300000

token_budget:
  warning_threshold: 0.75
  checkpoint_threshold: 0.85
  reserve_for_summary: 10000

models:
  default: "qwen3.5-plus"
  fallback_chain:
    - {
        model: "qwen3.5-plus",
        provider: "alibaba",
        mode: "engine",
        max_retries: 2,
      }
    - {
        model: "deepseek-v3",
        provider: "alibaba",
        mode: "engine",
        max_retries: 1,
      }
    - {
        model: "claude-sonnet",
        provider: "anthropic",
        mode: "delegate",
        max_retries: 1,
      }

providers:
  alibaba:
    api_key_env: "DASHSCOPE_API_KEY"
    base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1"
    rate_limit: { max_requests_per_minute: 8 }
  anthropic:
    binary: "claude"
    flags: ["-p", "--output-format", "stream-json"]
    estimated_daily_limit: 500000
    warning_percent: 0.70
    force_qwen_percent: 0.85

router:
  complexity_signals:
    refactor: 3
    debug: 3
    investigate: 2
    architecture: 3
    cross-repo: 4
    migration: 2
    security: 2
    crud: -2
    boilerplate: -3
    test: -1
    rename: -2
    "add field": -2
    "create endpoint": -1

validation:
  max_retries: 2
  typescript:
    - {
        name: "typecheck",
        command: "npx tsc --noEmit",
        required: true,
        retryable: true,
      }
    - {
        name: "lint",
        command: "npm run lint",
        required: false,
        retryable: true,
      }
    - { name: "test", command: "npm test", required: true, retryable: true }
  python:
    - { name: "typecheck", command: "mypy .", required: false, retryable: true }
    - {
        name: "lint",
        command: "ruff check .",
        required: false,
        retryable: true,
      }
    - { name: "test", command: "pytest", required: true, retryable: true }

mcp:
  inherit_from: "~/.claude/settings.json"
  servers: {}

notifications:
  telegram:
    enabled: true
    via_openclaw: true

cleanup:
  telemetry_heartbeat_retention_days: 14
  telemetry_events_retention_days: 90
  worktree_cleanup_after_pr_merge: true
  orphan_worktree_cleanup_on_startup: true

github:
  token_env: "GITHUB_TOKEN"
  default_org: "dougss"
  auto_create_pr: true
```

- [ ] **Step 6: Write failing config test**

File: `tests/unit/config.test.ts`

```typescript
import { describe, it, expect } from "vitest";
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
      validation: { max_retries: 2, typescript: [], python: [] },
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
      validation: { max_retries: 2, typescript: [], python: [] },
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
      validation: { max_retries: 2, typescript: [], python: [] },
    };
    expect(() => configSchema.parse(bad)).toThrow();
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `cd ~/server/apps/claw-engine && npm test`
Expected: FAIL (config-schema.ts doesn't exist yet / imports fail)

- [ ] **Step 8: Create all source files from steps 4-5, run test again**

Run: `cd ~/server/apps/claw-engine && npm test`
Expected: PASS (3 tests)

- [ ] **Step 9: Create database and Drizzle schema**

Create DB:

```bash
docker exec postgres psql -U admin -d postgres -c \
  "CREATE ROLE claw_engine WITH LOGIN PASSWORD 'claw_engine_local' CREATEDB; CREATE DATABASE claw_engine OWNER claw_engine;"
docker exec postgres psql -U admin -d claw_engine -c \
  "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";"
```

Create `src/storage/db.ts`:

```typescript
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema/index.js";

let dbInstance: ReturnType<typeof drizzle> | null = null;
let pool: pg.Pool | null = null;

export function getDb({ connectionString }: { connectionString: string }) {
  if (!dbInstance) {
    pool = new pg.Pool({ connectionString });
    dbInstance = drizzle(pool, { schema });
  }
  return dbInstance;
}

export async function closeDb() {
  if (pool) {
    await pool.end();
    pool = null;
    dbInstance = null;
  }
}
```

Create `src/storage/schema/work-items.ts`:

```typescript
import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  jsonb,
  bigint,
  numeric,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

export const workItems = pgTable(
  "work_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: varchar("title", { length: 512 }).notNull(),
    description: text("description"),
    source: varchar("source", { length: 64 }).notNull(),
    sourceRef: varchar("source_ref", { length: 512 }),
    status: varchar("status", { length: 32 }).notNull().default("queued"),
    priority: integer("priority").notNull().default(3),
    dag: jsonb("dag"),
    totalTokensUsed: bigint("total_tokens_used", { mode: "number" }).default(0),
    totalCostUsd: numeric("total_cost_usd", {
      precision: 10,
      scale: 4,
    }).default("0"),
    tasksTotal: integer("tasks_total").default(0),
    tasksCompleted: integer("tasks_completed").default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_work_items_status").on(table.status),
    index("idx_work_items_created").on(table.createdAt),
  ],
);
```

Create `src/storage/schema/tasks.ts`:

```typescript
import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  jsonb,
  bigint,
  numeric,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { workItems } from "./work-items.js";

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workItemId: uuid("work_item_id")
      .notNull()
      .references(() => workItems.id, { onDelete: "cascade" }),
    dagNodeId: varchar("dag_node_id", { length: 64 }).notNull(),
    repo: varchar("repo", { length: 256 }).notNull(),
    branch: varchar("branch", { length: 256 }).notNull(),
    worktreePath: varchar("worktree_path", { length: 512 }),
    description: text("description").notNull(),
    complexity: varchar("complexity", { length: 16 })
      .notNull()
      .default("medium"),
    contextFilter: text("context_filter").array(),
    nexusSkills: text("nexus_skills").array(),
    mcpServers: text("mcp_servers").array(),
    status: varchar("status", { length: 32 }).notNull().default("pending"),
    dependsOn: uuid("depends_on").array(),
    model: varchar("model", { length: 128 }),
    mode: varchar("mode", { length: 16 }),
    fallbackChainPosition: integer("fallback_chain_position").default(0),
    attempt: integer("attempt").notNull().default(1),
    maxAttempts: integer("max_attempts").notNull().default(3),
    retryPolicy: jsonb("retry_policy"),
    lastError: text("last_error"),
    errorClass: varchar("error_class", { length: 64 }),
    tokensUsed: bigint("tokens_used", { mode: "number" }).default(0),
    costUsd: numeric("cost_usd", { precision: 10, scale: 4 }).default("0"),
    durationMs: bigint("duration_ms", { mode: "number" }),
    checkpointData: jsonb("checkpoint_data"),
    checkpointCount: integer("checkpoint_count").default(0),
    validationAttempts: integer("validation_attempts").default(0),
    validationResults: jsonb("validation_results"),
    prUrl: varchar("pr_url", { length: 512 }),
    prNumber: integer("pr_number"),
    prStatus: varchar("pr_status", { length: 32 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_tasks_work_item").on(table.workItemId),
    index("idx_tasks_status").on(table.status),
    index("idx_tasks_repo").on(table.repo),
    index("idx_tasks_scheduling").on(table.workItemId, table.status),
  ],
);
```

Create `src/storage/schema/session-telemetry.ts`:

```typescript
import {
  pgTable,
  uuid,
  varchar,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { tasks } from "./tasks.js";

export const sessionTelemetry = pgTable(
  "session_telemetry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    correlationId: uuid("correlation_id").notNull(),
    eventType: varchar("event_type", { length: 64 }).notNull(),
    data: jsonb("data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_telemetry_task").on(table.taskId),
    index("idx_telemetry_correlation").on(table.correlationId),
    index("idx_telemetry_type").on(table.eventType),
    index("idx_telemetry_created").on(table.createdAt),
  ],
);
```

Create `src/storage/schema/routing-history.ts`:

```typescript
import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  bigint,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { tasks } from "./tasks.js";

export const routingHistory = pgTable(
  "routing_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    taskPattern: varchar("task_pattern", { length: 256 }).notNull(),
    repo: varchar("repo", { length: 256 }).notNull(),
    complexity: varchar("complexity", { length: 16 }).notNull(),
    keywords: text("keywords").array(),
    model: varchar("model", { length: 128 }).notNull(),
    success: boolean("success").notNull(),
    tokensUsed: bigint("tokens_used", { mode: "number" }),
    durationMs: bigint("duration_ms", { mode: "number" }),
    validationFirstPass: boolean("validation_first_pass"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_routing_pattern").on(table.taskPattern),
    index("idx_routing_model").on(table.model, table.success),
    index("idx_routing_created").on(table.createdAt),
  ],
);
```

Create `src/storage/schema/cost-snapshots.ts`:

```typescript
import {
  pgTable,
  uuid,
  varchar,
  bigint,
  numeric,
  integer,
  timestamp,
  date,
  unique,
} from "drizzle-orm/pg-core";

export const costSnapshots = pgTable(
  "cost_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    periodType: varchar("period_type", { length: 16 }).notNull(),
    periodStart: date("period_start").notNull(),
    claudeTokens: bigint("claude_tokens", { mode: "number" })
      .notNull()
      .default(0),
    alibabaTokens: bigint("alibaba_tokens", { mode: "number" })
      .notNull()
      .default(0),
    totalTokens: bigint("total_tokens", { mode: "number" })
      .notNull()
      .default(0),
    alibabaCostUsd: numeric("alibaba_cost_usd", { precision: 10, scale: 4 })
      .notNull()
      .default("0"),
    estimatedClaudeCostUsd: numeric("estimated_claude_cost_usd", {
      precision: 10,
      scale: 4,
    })
      .notNull()
      .default("0"),
    estimatedSavingsUsd: numeric("estimated_savings_usd", {
      precision: 10,
      scale: 4,
    })
      .notNull()
      .default("0"),
    sessionsTotal: integer("sessions_total").notNull().default(0),
    sessionsEngine: integer("sessions_engine").notNull().default(0),
    sessionsDelegate: integer("sessions_delegate").notNull().default(0),
    workItemsCompleted: integer("work_items_completed").notNull().default(0),
    escalations: integer("escalations").notNull().default(0),
    firstPassSuccessRate: numeric("first_pass_success_rate", {
      precision: 5,
      scale: 2,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique("uq_cost_period").on(table.periodType, table.periodStart)],
);
```

Create `src/storage/schema/index.ts`:

```typescript
export { workItems } from "./work-items.js";
export { tasks } from "./tasks.js";
export { sessionTelemetry } from "./session-telemetry.js";
export { routingHistory } from "./routing-history.js";
export { costSnapshots } from "./cost-snapshots.js";
```

Create `drizzle.config.ts`:

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/storage/schema/index.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.CLAW_ENGINE_DATABASE_URL ??
      "postgres://claw_engine:claw_engine_local@127.0.0.1:5432/claw_engine",
  },
});
```

- [ ] **Step 10: Generate and run Drizzle migration**

```bash
cd ~/server/apps/claw-engine
npx drizzle-kit generate
CLAW_ENGINE_DATABASE_URL="postgres://claw_engine:claw_engine_local@127.0.0.1:5432/claw_engine" npx drizzle-kit migrate
```

Expected: migration file(s) in `migrations/`, tables created in `claw_engine` DB.

Verify:

```bash
docker exec postgres psql -U claw_engine -d claw_engine -c "\dt"
```

Expected: lists `work_items`, `tasks`, `session_telemetry`, `routing_history`, `cost_snapshots`.

- [ ] **Step 11: Run all tests**

Run: `cd ~/server/apps/claw-engine && npm test`
Expected: PASS

- [ ] **Step 12: Commit**

```bash
cd ~/server/apps/claw-engine
git init
git add -A
git commit -m "feat: scaffold claw-engine repo with config, DB schema, migrations"
```

---

## Task 2: Shared types + HarnessEvent definitions

**Files:**

- Create: `src/types.ts`
- Create: `src/harness/events.ts`
- Test: `tests/unit/harness/events.test.ts`

- [ ] **Step 1: Write failing test for event type guards**

```typescript
import { describe, it, expect } from "vitest";
import {
  isToolUseEvent,
  isSessionEndEvent,
  createTextDelta,
  createTokenUpdate,
} from "../../src/harness/events.js";

describe("HarnessEvent helpers", () => {
  it("createTextDelta produces correct shape", () => {
    const event = createTextDelta("hello");
    expect(event.type).toBe("text_delta");
    expect(event.text).toBe("hello");
  });

  it("createTokenUpdate computes percent", () => {
    const event = createTokenUpdate({ used: 85000, budget: 100000 });
    expect(event.percent).toBe(85);
  });

  it("isToolUseEvent returns true for tool_use", () => {
    expect(
      isToolUseEvent({ type: "tool_use", id: "1", name: "bash", input: {} }),
    ).toBe(true);
    expect(isToolUseEvent({ type: "text_delta", text: "hi" })).toBe(false);
  });

  it("isSessionEndEvent detects session_end", () => {
    expect(
      isSessionEndEvent({ type: "session_end", reason: "completed" }),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run test; expect FAIL**

Run: `cd ~/server/apps/claw-engine && npm test`
Expected: FAIL (events.ts not found)

- [ ] **Step 3: Implement `src/types.ts` and `src/harness/events.ts`**

`src/types.ts`:

```typescript
export const TASK_STATUS = {
  pending: "pending",
  merging_dependency: "merging_dependency",
  provisioning: "provisioning",
  starting: "starting",
  running: "running",
  checkpointing: "checkpointing",
  resuming: "resuming",
  validating: "validating",
  completed: "completed",
  stalled: "stalled",
  failed: "failed",
  needs_human_review: "needs_human_review",
  interrupted: "interrupted",
  blocked: "blocked",
  skipped: "skipped",
  cancelled: "cancelled",
} as const;

export type TaskStatus = (typeof TASK_STATUS)[keyof typeof TASK_STATUS];

export const WORK_ITEM_STATUS = {
  queued: "queued",
  decomposing: "decomposing",
  running: "running",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
} as const;

export type WorkItemStatus =
  (typeof WORK_ITEM_STATUS)[keyof typeof WORK_ITEM_STATUS];

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolUseId?: string;
  toolName?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolResult {
  output: string;
  isError: boolean;
}
```

`src/harness/events.ts`:

```typescript
export type HarnessEvent =
  | { type: "session_start"; sessionId: string; model: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; output: string; isError: boolean }
  | { type: "permission_denied"; tool: string; reason: string }
  | { type: "token_update"; used: number; budget: number; percent: number }
  | { type: "checkpoint"; reason: "token_limit" | "stall" | "manual" }
  | {
      type: "session_end";
      reason: "completed" | "checkpoint" | "error" | "max_iterations";
    };

export function createTextDelta(text: string): HarnessEvent {
  return { type: "text_delta", text };
}

export function createTokenUpdate({
  used,
  budget,
}: {
  used: number;
  budget: number;
}): HarnessEvent & { type: "token_update" } {
  return {
    type: "token_update",
    used,
    budget,
    percent: Math.round((used / budget) * 100),
  };
}

export function isToolUseEvent(
  event: HarnessEvent,
): event is HarnessEvent & { type: "tool_use" } {
  return event.type === "tool_use";
}

export function isSessionEndEvent(
  event: HarnessEvent,
): event is HarnessEvent & { type: "session_end" } {
  return event.type === "session_end";
}

export function isCheckpointEvent(
  event: HarnessEvent,
): event is HarnessEvent & { type: "checkpoint" } {
  return event.type === "checkpoint";
}
```

- [ ] **Step 4: Run tests; expect PASS**

Run: `cd ~/server/apps/claw-engine && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: shared types and HarnessEvent definitions"
```

---

## Task 3: Token budget manager

**Files:**

- Create: `src/harness/token-budget.ts`
- Test: `tests/unit/harness/token-budget.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from "vitest";
import {
  createTokenBudget,
  trackTokens,
  estimateTokens,
  shouldWarn,
  shouldCheckpoint,
} from "../../src/harness/token-budget.js";

describe("token-budget", () => {
  it("estimateTokens uses len/4+1 heuristic", () => {
    expect(estimateTokens("hello world")).toBe(
      Math.ceil("hello world".length / 4) + 1,
    );
  });

  it("creates budget with correct thresholds", () => {
    const budget = createTokenBudget({
      maxContext: 128000,
      warningThreshold: 0.75,
      checkpointThreshold: 0.85,
      reserveForSummary: 10000,
    });
    expect(budget.maxContext).toBe(128000);
    expect(budget.warningAt).toBe(96000);
    expect(budget.checkpointAt).toBe(108800);
  });

  it("tracks system prompt + message tokens", () => {
    const budget = createTokenBudget({
      maxContext: 100000,
      warningThreshold: 0.75,
      checkpointThreshold: 0.85,
      reserveForSummary: 10000,
    });
    const updated = trackTokens(budget, {
      systemPromptTokens: 3000,
      messagesTokens: 70000,
    });
    expect(updated.currentTotal).toBe(73000);
    expect(shouldWarn(updated)).toBe(false);
  });

  it("triggers warning at 75%", () => {
    const budget = createTokenBudget({
      maxContext: 100000,
      warningThreshold: 0.75,
      checkpointThreshold: 0.85,
      reserveForSummary: 10000,
    });
    const updated = trackTokens(budget, {
      systemPromptTokens: 3000,
      messagesTokens: 73000,
    });
    expect(shouldWarn(updated)).toBe(true);
    expect(shouldCheckpoint(updated)).toBe(false);
  });

  it("triggers checkpoint at 85%", () => {
    const budget = createTokenBudget({
      maxContext: 100000,
      warningThreshold: 0.75,
      checkpointThreshold: 0.85,
      reserveForSummary: 10000,
    });
    const updated = trackTokens(budget, {
      systemPromptTokens: 3000,
      messagesTokens: 83000,
    });
    expect(shouldCheckpoint(updated)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test; expect FAIL**

Run: `npm test`

- [ ] **Step 3: Implement `src/harness/token-budget.ts`**

```typescript
export interface TokenBudget {
  maxContext: number;
  warningAt: number;
  checkpointAt: number;
  reserveForSummary: number;
  systemPromptTokens: number;
  messagesTokens: number;
  currentTotal: number;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4) + 1;
}

export function createTokenBudget({
  maxContext,
  warningThreshold,
  checkpointThreshold,
  reserveForSummary,
}: {
  maxContext: number;
  warningThreshold: number;
  checkpointThreshold: number;
  reserveForSummary: number;
}): TokenBudget {
  return {
    maxContext,
    warningAt: Math.floor(maxContext * warningThreshold),
    checkpointAt: Math.floor(maxContext * checkpointThreshold),
    reserveForSummary,
    systemPromptTokens: 0,
    messagesTokens: 0,
    currentTotal: 0,
  };
}

export function trackTokens(
  budget: TokenBudget,
  {
    systemPromptTokens,
    messagesTokens,
  }: { systemPromptTokens: number; messagesTokens: number },
): TokenBudget {
  return {
    ...budget,
    systemPromptTokens,
    messagesTokens,
    currentTotal: systemPromptTokens + messagesTokens,
  };
}

export function shouldWarn(budget: TokenBudget): boolean {
  return budget.currentTotal >= budget.warningAt;
}

export function shouldCheckpoint(budget: TokenBudget): boolean {
  return budget.currentTotal >= budget.checkpointAt;
}
```

- [ ] **Step 4: Run tests; expect PASS**

Run: `npm test`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: token budget manager with heuristic estimator"
```

---

## Task 4: Permission system

**Files:**

- Create: `src/harness/permissions.ts`
- Test: `tests/unit/harness/permissions.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from "vitest";
import {
  evaluatePermission,
  DEFAULT_PERMISSION_RULES,
} from "../../src/harness/permissions.js";

describe("permissions", () => {
  it("allows read-only tools unconditionally", () => {
    const result = evaluatePermission({
      tool: "read_file",
      input: { path: "/any/file" },
      workspacePath: "/ws",
      rules: DEFAULT_PERMISSION_RULES,
    });
    expect(result.action).toBe("allow");
  });

  it("allows write_file inside workspace", () => {
    const result = evaluatePermission({
      tool: "write_file",
      input: { path: "/ws/src/foo.ts" },
      workspacePath: "/ws",
      rules: DEFAULT_PERMISSION_RULES,
    });
    expect(result.action).toBe("allow");
  });

  it("denies write_file outside workspace", () => {
    const result = evaluatePermission({
      tool: "write_file",
      input: { path: "/etc/passwd" },
      workspacePath: "/ws",
      rules: DEFAULT_PERMISSION_RULES,
    });
    expect(result.action).toBe("deny");
    expect(result.reason).toContain("outside workspace");
  });

  it("allows safe bash commands", () => {
    const result = evaluatePermission({
      tool: "bash",
      input: { command: "git status" },
      workspacePath: "/ws",
      rules: DEFAULT_PERMISSION_RULES,
    });
    expect(result.action).toBe("allow");
  });

  it("denies destructive bash commands", () => {
    const result = evaluatePermission({
      tool: "bash",
      input: { command: "rm -rf /" },
      workspacePath: "/ws",
      rules: DEFAULT_PERMISSION_RULES,
    });
    expect(result.action).toBe("deny");
    expect(result.reason).toContain("destructive");
  });

  it("denies git push --force", () => {
    const result = evaluatePermission({
      tool: "bash",
      input: { command: "git push --force origin main" },
      workspacePath: "/ws",
      rules: DEFAULT_PERMISSION_RULES,
    });
    expect(result.action).toBe("deny");
  });

  it("denies drop database", () => {
    const result = evaluatePermission({
      tool: "bash",
      input: { command: "psql -c 'DROP DATABASE foo'" },
      workspacePath: "/ws",
      rules: DEFAULT_PERMISSION_RULES,
    });
    expect(result.action).toBe("deny");
  });

  it("allows ask_user unconditionally", () => {
    const result = evaluatePermission({
      tool: "ask_user",
      input: { question: "?" },
      workspacePath: "/ws",
      rules: DEFAULT_PERMISSION_RULES,
    });
    expect(result.action).toBe("allow");
  });
});
```

- [ ] **Step 2: Run test; expect FAIL**

- [ ] **Step 3: Implement `src/harness/permissions.ts`**

```typescript
export interface PermissionRule {
  tool: string;
  action: "allow" | "deny" | "prompt";
  conditions?: {
    path_prefix?: string;
    command_pattern?: string;
  };
}

interface PermissionInput {
  tool: string;
  input: Record<string, unknown>;
  workspacePath: string;
  rules: PermissionRule[];
}

interface PermissionResult {
  action: "allow" | "deny" | "prompt";
  reason: string;
}

const DESTRUCTIVE_PATTERNS = [
  /rm\s+(-\w*f|-\w*r).*\//i,
  /git\s+push\s+--force/i,
  /git\s+push\s+-f/i,
  /drop\s+(database|table|schema)/i,
  /truncate\s+/i,
  />\s*\/dev\/sd/i,
  /mkfs\./i,
  /:(){ :\|:& };:/,
];

const ALWAYS_ALLOW_TOOLS = new Set(["read_file", "glob", "grep", "ask_user"]);

export const DEFAULT_PERMISSION_RULES: PermissionRule[] = [
  { tool: "read_file", action: "allow" },
  { tool: "glob", action: "allow" },
  { tool: "grep", action: "allow" },
  { tool: "ask_user", action: "allow" },
  {
    tool: "write_file",
    action: "allow",
    conditions: { path_prefix: "{{workspace}}" },
  },
  {
    tool: "edit_file",
    action: "allow",
    conditions: { path_prefix: "{{workspace}}" },
  },
  { tool: "bash", action: "allow" },
];

export function evaluatePermission({
  tool,
  input,
  workspacePath,
  rules,
}: PermissionInput): PermissionResult {
  if (ALWAYS_ALLOW_TOOLS.has(tool)) {
    return { action: "allow", reason: "read-only or always-allowed tool" };
  }

  if (tool === "write_file" || tool === "edit_file") {
    const filePath = String(input.path ?? "");
    if (!filePath.startsWith(workspacePath)) {
      return { action: "deny", reason: `path outside workspace: ${filePath}` };
    }
    return { action: "allow", reason: "path inside workspace" };
  }

  if (tool === "bash") {
    const command = String(input.command ?? "");
    for (const pattern of DESTRUCTIVE_PATTERNS) {
      if (pattern.test(command)) {
        return {
          action: "deny",
          reason: `destructive command pattern: ${pattern.source}`,
        };
      }
    }
    return { action: "allow", reason: "no destructive patterns detected" };
  }

  const matchingRule = rules.find((r) => r.tool === tool);
  if (matchingRule) {
    return { action: matchingRule.action, reason: `matched rule for ${tool}` };
  }

  return { action: "prompt", reason: `no explicit rule for tool: ${tool}` };
}
```

- [ ] **Step 4: Run tests; expect PASS**

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: permission system with destructive command deny list"
```

---

## Task 5: Built-in tools (7 tools)

**Files:**

- Create: `src/harness/tools/tool-types.ts`
- Create: `src/harness/tools/tool-registry.ts`
- Create: `src/harness/tools/builtins/bash.ts`
- Create: `src/harness/tools/builtins/read-file.ts`
- Create: `src/harness/tools/builtins/write-file.ts`
- Create: `src/harness/tools/builtins/edit-file.ts`
- Create: `src/harness/tools/builtins/glob-tool.ts`
- Create: `src/harness/tools/builtins/grep-tool.ts`
- Create: `src/harness/tools/builtins/ask-user.ts`
- Test: `tests/unit/tools/builtins.test.ts`

- [ ] **Step 1: Write failing tests for tool interface contracts**

Test that each tool: has correct name/description/inputSchema, returns `{ output, isError }`, handles invalid input gracefully. For `bash`: test timeout, background flag, deny pattern passthrough. For `read_file`: test offset/limit. For `write_file`: test creates file. For `edit_file`: test string replacement. For `glob`/`grep`: test basic patterns against a temp directory. For `ask_user`: test it returns a pending marker.

- [ ] **Step 2: Implement `tool-types.ts`**

```typescript
import type { ToolResult } from "../../types.js";

export interface ToolHandler {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(
    input: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult>;
}

export interface ToolContext {
  workspacePath: string;
  sessionId: string;
  onAskUser?: (question: string) => Promise<string>;
}
```

- [ ] **Step 3: Implement `tool-registry.ts`**

```typescript
import type { ToolHandler } from "./tool-types.js";

const registry = new Map<string, ToolHandler>();

export function registerTool(handler: ToolHandler) {
  registry.set(handler.name, handler);
}

export function getTool(name: string): ToolHandler | undefined {
  return registry.get(name);
}

export function getAllTools(): ToolHandler[] {
  return Array.from(registry.values());
}

export function getToolDefinitions() {
  return getAllTools().map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
}
```

- [ ] **Step 4: Implement each built-in tool** (bash with `child_process.execSync`/`spawn`, read_file with `fs.readFileSync` + offset/limit, write_file with `fs.writeFileSync` + directory creation, edit_file with string replacement, glob with `fast-glob`, grep with `child_process.execSync` calling `rg`, ask_user with pending token)

- [ ] **Step 5: Run tests; expect PASS**

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: 7 built-in tools with registry"
```

---

## Task 6: Model adapters (Mock + Alibaba)

**Files:**

- Create: `src/harness/model-adapters/adapter-types.ts`
- Create: `src/harness/model-adapters/mock-adapter.ts`
- Create: `src/harness/model-adapters/alibaba-adapter.ts`
- Test: `tests/unit/harness/mock-adapter.test.ts`

- [ ] **Step 1: Write failing test for MockAdapter**

```typescript
import { describe, it, expect } from "vitest";
import { createMockAdapter } from "../../src/harness/model-adapters/mock-adapter.js";

describe("MockAdapter", () => {
  it("yields scripted events in order", async () => {
    const adapter = createMockAdapter({
      name: "test-mock",
      responses: [
        [
          { type: "text_delta", text: "I'll read the file" },
          {
            type: "tool_use",
            id: "t1",
            name: "read_file",
            input: { path: "/tmp/test.txt" },
          },
        ],
        [{ type: "text_delta", text: "Done" }],
      ],
    });

    const events1: unknown[] = [];
    for await (const e of adapter.chat([], [])) {
      events1.push(e);
    }
    expect(events1).toHaveLength(2);
    expect(events1[0]).toEqual({
      type: "text_delta",
      text: "I'll read the file",
    });

    const events2: unknown[] = [];
    for await (const e of adapter.chat([], [])) {
      events2.push(e);
    }
    expect(events2).toHaveLength(1);
  });

  it("reports correct capabilities", () => {
    const adapter = createMockAdapter({ name: "test", responses: [] });
    expect(adapter.supportsToolUse).toBe(true);
    expect(adapter.supportsStreaming).toBe(true);
    expect(adapter.maxContext).toBe(128000);
  });
});
```

- [ ] **Step 2: Run test; expect FAIL**

- [ ] **Step 3: Implement adapter interface (`adapter-types.ts`)**

```typescript
import type { Message, ToolDefinition } from "../../types.js";
import type { HarnessEvent } from "../events.js";

export interface ModelAdapter {
  name: string;
  provider: "alibaba" | "anthropic" | "google" | "openai" | "local" | "mock";
  maxContext: number;
  supportsToolUse: boolean;
  supportsStreaming: boolean;
  costPerInputToken: number;
  costPerOutputToken: number;
  chat(
    messages: Message[],
    tools: ToolDefinition[],
  ): AsyncIterable<HarnessEvent>;
}
```

- [ ] **Step 4: Implement `MockAdapter`**

```typescript
import type { ModelAdapter } from "./adapter-types.js";
import type { HarnessEvent } from "../events.js";
import type { Message, ToolDefinition } from "../../types.js";

interface MockAdapterOptions {
  name: string;
  responses: HarnessEvent[][];
  maxContext?: number;
}

export function createMockAdapter({
  name,
  responses,
  maxContext = 128000,
}: MockAdapterOptions): ModelAdapter {
  let callIndex = 0;

  return {
    name,
    provider: "mock",
    maxContext,
    supportsToolUse: true,
    supportsStreaming: true,
    costPerInputToken: 0,
    costPerOutputToken: 0,

    async *chat(
      _messages: Message[],
      _tools: ToolDefinition[],
    ): AsyncIterable<HarnessEvent> {
      const events = responses[callIndex] ?? [];
      callIndex++;
      for (const event of events) {
        yield event;
      }
    },
  };
}
```

- [ ] **Step 5: Implement `AlibabaAdapter`** (DashScope OpenAI-compatible endpoint with tool_use, streaming via SSE, converts to HarnessEvent stream). This is a real HTTP adapter, so unit tests use mocking; a manual smoke test can validate against the actual API.

- [ ] **Step 6: Run tests; expect PASS**

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: model adapter interface with Mock and Alibaba implementations"
```

---

## Task 7: Agentic loop

**Files:**

- Create: `src/harness/agent-loop.ts`
- Test: `tests/unit/harness/agent-loop.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from "vitest";
import { runAgentLoop } from "../../src/harness/agent-loop.js";
import { createMockAdapter } from "../../src/harness/model-adapters/mock-adapter.js";

describe("agent-loop", () => {
  it("completes when model returns no tool_use", async () => {
    const adapter = createMockAdapter({
      name: "simple",
      responses: [[{ type: "text_delta", text: "Done" }]],
    });

    const events: unknown[] = [];
    for await (const e of runAgentLoop({
      adapter,
      systemPrompt: "You are a test agent",
      userPrompt: "Say hello",
      tools: [],
      maxIterations: 16,
      tokenBudget: {
        maxContext: 128000,
        warningAt: 96000,
        checkpointAt: 108800,
        reserveForSummary: 10000,
        systemPromptTokens: 0,
        messagesTokens: 0,
        currentTotal: 0,
      },
      workspacePath: "/tmp",
    })) {
      events.push(e);
    }

    expect(
      events.some(
        (e: any) => e.type === "session_end" && e.reason === "completed",
      ),
    ).toBe(true);
  });

  it("executes tool calls and feeds result back", async () => {
    const adapter = createMockAdapter({
      name: "tool-user",
      responses: [
        [
          {
            type: "tool_use",
            id: "t1",
            name: "read_file",
            input: { path: "/tmp/x" },
          },
        ],
        [{ type: "text_delta", text: "File read" }],
      ],
    });

    const events: unknown[] = [];
    for await (const e of runAgentLoop({
      adapter,
      systemPrompt: "test",
      userPrompt: "read a file",
      tools: [
        {
          name: "read_file",
          description: "Read a file",
          inputSchema: {
            type: "object",
            properties: { path: { type: "string" } },
          },
        },
      ],
      maxIterations: 16,
      tokenBudget: {
        maxContext: 128000,
        warningAt: 96000,
        checkpointAt: 108800,
        reserveForSummary: 10000,
        systemPromptTokens: 0,
        messagesTokens: 0,
        currentTotal: 0,
      },
      workspacePath: "/tmp",
    })) {
      events.push(e);
    }

    expect(events.some((e: any) => e.type === "tool_result")).toBe(true);
    expect(
      events.some(
        (e: any) => e.type === "session_end" && e.reason === "completed",
      ),
    ).toBe(true);
  });

  it("stops at max iterations", async () => {
    const infiniteToolUse = Array(20).fill([
      {
        type: "tool_use",
        id: "t1",
        name: "bash",
        input: { command: "echo hi" },
      },
    ]);
    const adapter = createMockAdapter({
      name: "looper",
      responses: infiniteToolUse,
    });

    const events: unknown[] = [];
    for await (const e of runAgentLoop({
      adapter,
      systemPrompt: "test",
      userPrompt: "loop",
      tools: [{ name: "bash", description: "Run command", inputSchema: {} }],
      maxIterations: 3,
      tokenBudget: {
        maxContext: 128000,
        warningAt: 96000,
        checkpointAt: 108800,
        reserveForSummary: 10000,
        systemPromptTokens: 0,
        messagesTokens: 0,
        currentTotal: 0,
      },
      workspacePath: "/tmp",
    })) {
      events.push(e);
    }

    expect(
      events.some(
        (e: any) => e.type === "session_end" && e.reason === "max_iterations",
      ),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run test; expect FAIL**

- [ ] **Step 3: Implement `src/harness/agent-loop.ts`**

The agentic loop:

1. Builds initial messages array: `[{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }]`
2. Loops up to `maxIterations`:
   a. Calls `adapter.chat(messages, tools)`
   b. Collects events; yields each to caller
   c. If event is `tool_use`: runs permission check → executes tool → appends tool_result to messages → yields `tool_result` event
   d. If event is `text_delta` with no `tool_use`: the turn is complete → yield `session_end` with `reason: "completed"`
   e. Tracks tokens after each turn
   f. If token budget triggers checkpoint: yield `checkpoint` event → yield `session_end` with `reason: "checkpoint"`
3. If loop exhausts `maxIterations`: yield `session_end` with `reason: "max_iterations"`

- [ ] **Step 4: Run tests; expect PASS**

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: agentic loop with tool execution and iteration limits"
```

---

## Task 8: Context builder (6-layer system prompt)

**Files:**

- Create: `src/harness/context-builder.ts`
- Create: `tests/fixtures/sample-claude.md`
- Test: `tests/unit/harness/context-builder.test.ts`

- [ ] **Step 1: Create fixture file `tests/fixtures/sample-claude.md`**

```markdown
# My Project

## Overview

This is a sample project for testing.

## Database

PostgreSQL on port 5432 with pgvector.

## API

Fastify on port 3000 with REST endpoints.

## Security

SSH key-only, firewall ON.

## Deployment

LaunchAgent with KeepAlive.
```

- [ ] **Step 2: Write golden-file tests**

```typescript
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildSystemPrompt } from "../../src/harness/context-builder.js";

const sampleClaudeMd = readFileSync(
  resolve(import.meta.dirname, "../fixtures/sample-claude.md"),
  "utf-8",
);

describe("context-builder", () => {
  it("includes identity layer", () => {
    const prompt = buildSystemPrompt({
      task: {
        description: "Add API endpoint",
        contextFilter: [],
        nexusSkills: [],
      },
      tools: [{ name: "bash", description: "Run shell", inputSchema: {} }],
      projectContext: sampleClaudeMd,
    });
    expect(prompt).toContain("You are a coding agent");
  });

  it("includes tool schemas", () => {
    const prompt = buildSystemPrompt({
      task: { description: "test", contextFilter: [], nexusSkills: [] },
      tools: [
        {
          name: "read_file",
          description: "Read a file",
          inputSchema: { type: "object" },
        },
      ],
      projectContext: sampleClaudeMd,
    });
    expect(prompt).toContain("read_file");
  });

  it("filters CLAUDE.md by context_filter headings", () => {
    const prompt = buildSystemPrompt({
      task: {
        description: "Fix DB issue",
        contextFilter: ["Database", "Security"],
        nexusSkills: [],
      },
      tools: [],
      projectContext: sampleClaudeMd,
    });
    expect(prompt).toContain("PostgreSQL on port 5432");
    expect(prompt).toContain("SSH key-only");
    expect(prompt).not.toContain("LaunchAgent with KeepAlive");
  });

  it("falls back to first 50 lines if no heading matches", () => {
    const prompt = buildSystemPrompt({
      task: {
        description: "test",
        contextFilter: ["NonExistentSection"],
        nexusSkills: [],
      },
      tools: [],
      projectContext: sampleClaudeMd,
    });
    expect(prompt).toContain("This is a sample project");
  });

  it("includes checkpoint when resuming", () => {
    const prompt = buildSystemPrompt({
      task: { description: "test", contextFilter: [], nexusSkills: [] },
      tools: [],
      projectContext: sampleClaudeMd,
      checkpoint: {
        summary: "Implemented the auth module. Next: add tests.",
        recentMessages: [
          { role: "assistant", content: "I created auth.ts" },
          { role: "user", content: "Now add tests" },
        ],
      },
    });
    expect(prompt).toContain("Implemented the auth module");
    expect(prompt).toContain("I created auth.ts");
  });
});
```

- [ ] **Step 3: Run test; expect FAIL**

- [ ] **Step 4: Implement `src/harness/context-builder.ts`**

Build 6 layers: IDENTITY (fixed ~200 tokens), TOOLS (schema JSON), TASK CONTEXT (description + DAG position), PROJECT CONTEXT (filtered CLAUDE.md sections by heading match, case-insensitive, or first 50 lines), NEXUS SKILLS (placeholder for later), CHECKPOINT (optional resume data with summary + last 4 messages).

- [ ] **Step 5: Run tests; expect PASS**

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: 6-layer context builder with heading-filtered CLAUDE.md"
```

---

## Task 9: Claude Pipe adapter (Delegate Mode)

**Files:**

- Create: `src/integrations/claude-p/claude-pipe.ts`
- Create: `src/harness/model-adapters/claude-pipe-adapter.ts`
- Test: `tests/unit/integrations/claude-pipe-parse.test.ts`

- [ ] **Step 1: Write failing tests for stream-json parsing**

Test that given a sequence of JSON lines from `claude -p --output-format stream-json`, the parser produces correct `HarnessEvent` objects. Test cases: text content, tool_use blocks, tool_result feedback, session end. Test subprocess error (exit code != 0). Test timeout handling.

- [ ] **Step 2: Run test; expect FAIL**

- [ ] **Step 3: Implement `claude-pipe.ts`** (spawns `claude -p --output-format stream-json` as child process, reads stdout line by line, parses JSON into HarnessEvent stream)

- [ ] **Step 4: Implement `claude-pipe-adapter.ts`** (wraps `claude-pipe.ts` as a `ModelAdapter`, translates stream events, handles process lifecycle)

- [ ] **Step 5: Run tests; expect PASS**

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: ClaudePipeAdapter for Delegate Mode (claude -p)"
```

---

## Task 10: Session manager + worktree provisioning

**Files:**

- Create: `src/core/session-manager.ts`
- Create: `src/core/state-machine.ts`
- Create: `src/integrations/git/worktrees.ts`
- Test: `tests/unit/core/state-machine.test.ts`
- Test: `tests/integration/session-manager.test.ts`

- [ ] **Step 1: Write failing tests for state machine transitions**

```typescript
import { describe, it, expect } from "vitest";
import { transition, isValidTransition } from "../../src/core/state-machine.js";

describe("state-machine", () => {
  it("allows pending → provisioning", () => {
    expect(isValidTransition("pending", "provisioning")).toBe(true);
  });

  it("allows running → checkpointing", () => {
    expect(isValidTransition("running", "checkpointing")).toBe(true);
  });

  it("disallows completed → running", () => {
    expect(isValidTransition("completed", "running")).toBe(false);
  });

  it("allows running → validating → completed", () => {
    expect(isValidTransition("running", "validating")).toBe(true);
    expect(isValidTransition("validating", "completed")).toBe(true);
  });

  it("allows validating → running (retry)", () => {
    expect(isValidTransition("validating", "running")).toBe(true);
  });

  it("allows running → stalled → starting (retry)", () => {
    expect(isValidTransition("running", "stalled")).toBe(true);
    expect(isValidTransition("stalled", "starting")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test; expect FAIL**

- [ ] **Step 3: Implement `state-machine.ts`** with a transition map covering all states from spec section 6 Lifecycle diagram

- [ ] **Step 4: Implement `worktrees.ts`**

```typescript
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export async function createWorktree({
  repoPath,
  worktreesDir,
  taskId,
  branch,
}: {
  repoPath: string;
  worktreesDir: string;
  taskId: string;
  branch: string;
}): Promise<string> {
  const worktreePath = join(worktreesDir, taskId);
  execSync(`git -C ${repoPath} worktree add ${worktreePath} -b ${branch}`, {
    stdio: "pipe",
  });

  if (existsSync(join(worktreePath, "package-lock.json"))) {
    execSync("npm ci", { cwd: worktreePath, stdio: "pipe" });
  }

  return worktreePath;
}

export async function removeWorktree({
  repoPath,
  worktreePath,
}: {
  repoPath: string;
  worktreePath: string;
}): Promise<void> {
  execSync(`git -C ${repoPath} worktree remove ${worktreePath} --force`, {
    stdio: "pipe",
  });
}

export async function listWorktrees({
  repoPath,
}: {
  repoPath: string;
}): Promise<string[]> {
  const output = execSync(`git -C ${repoPath} worktree list --porcelain`, {
    encoding: "utf-8",
  });
  return output
    .split("\n")
    .filter((l) => l.startsWith("worktree "))
    .map((l) => l.replace("worktree ", ""));
}
```

- [ ] **Step 5: Implement `session-manager.ts`** (orchestrates: provision workspace → build context → resolve model via router → run agentic loop → run validation → transition states → persist telemetry)

- [ ] **Step 6: Write integration test** that creates a tiny git repo in `/tmp`, provisions a worktree, runs a mock session, validates state transitions

- [ ] **Step 7: Run all tests; expect PASS**

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: session manager with state machine and worktree provisioning"
```

---

## Task 11: Checkpoint/resume + session recording

**Files:**

- Create: `src/harness/recordings/recording-format.ts`
- Create: `src/harness/recordings/recorder.ts`
- Create: `src/harness/recordings/recorded-adapter.ts`
- Modify: `src/harness/agent-loop.ts` (add checkpoint handling)
- Modify: `src/core/session-manager.ts` (add resume flow)
- Test: `tests/unit/harness/checkpoint.test.ts`
- Test: `tests/unit/harness/recorded-adapter.test.ts`

- [ ] **Step 1: Write failing tests for checkpoint trigger and recording replay**

- [ ] **Step 2: Implement recording format** (JSONL: one HarnessEvent per line with timestamp)

- [ ] **Step 3: Implement recorder** (wraps agentic loop, writes events to JSONL file)

- [ ] **Step 4: Implement recorded adapter** (reads JSONL, replays events as MockAdapter — for regression tests)

- [ ] **Step 5: Add checkpoint handling to agent-loop** (when token budget hits 85%, inject summary request, save state, yield checkpoint event)

- [ ] **Step 6: Add resume flow to session-manager** (load checkpoint data, build system prompt with checkpoint layer, start new session)

- [ ] **Step 7: Run tests; expect PASS**

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: checkpoint/resume and session recording for replay tests"
```

---

## Task 12: Output validation runner

**Files:**

- Create: `src/core/validation-runner.ts`
- Test: `tests/unit/core/validation-runner.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect, vi } from "vitest";
import { runValidation } from "../../src/core/validation-runner.js";

describe("validation-runner", () => {
  it("runs all steps and returns results", async () => {
    const results = await runValidation({
      workspacePath: "/tmp/test-ws",
      steps: [
        {
          name: "typecheck",
          command: "echo ok",
          required: true,
          retryable: true,
        },
        {
          name: "test",
          command: "echo passed",
          required: true,
          retryable: true,
        },
      ],
      execCommand: async (cmd, cwd) => ({ stdout: "ok", exitCode: 0 }),
    });
    expect(results.passed).toBe(true);
    expect(results.steps).toHaveLength(2);
    expect(results.steps.every((s) => s.passed)).toBe(true);
  });

  it("returns failed when required step fails", async () => {
    const results = await runValidation({
      workspacePath: "/tmp/test-ws",
      steps: [
        { name: "typecheck", command: "tsc", required: true, retryable: true },
      ],
      execCommand: async () => ({
        stdout: "error TS2304: Cannot find name 'foo'",
        exitCode: 1,
      }),
    });
    expect(results.passed).toBe(false);
    expect(results.steps[0].passed).toBe(false);
    expect(results.steps[0].output).toContain("TS2304");
  });

  it("passes when optional step fails", async () => {
    const results = await runValidation({
      workspacePath: "/tmp/test-ws",
      steps: [
        { name: "lint", command: "lint", required: false, retryable: true },
        { name: "test", command: "test", required: true, retryable: true },
      ],
      execCommand: async (cmd) =>
        cmd.includes("lint")
          ? { stdout: "warning", exitCode: 1 }
          : { stdout: "pass", exitCode: 0 },
    });
    expect(results.passed).toBe(true);
  });
});
```

- [ ] **Step 2: Run test; expect FAIL**

- [ ] **Step 3: Implement `validation-runner.ts`**

- [ ] **Step 4: Run tests; expect PASS**

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: output validation runner for typecheck/lint/test"
```

---

## Task 13: Health monitor

**Files:**

- Create: `src/core/health-monitor.ts`
- Test: `tests/unit/core/health-monitor.test.ts`

- [ ] **Step 1: Write failing tests** for heartbeat tracking (stall detection), memory check (RSS limit), disk check (worktree size limit), token threshold forwarding

- [ ] **Step 2: Implement `health-monitor.ts`**

Runs on interval (`health_check_interval_ms`), checks:

- Heartbeat: last output timestamp vs stall timeout (engine: 60s, delegate: 300s)
- Memory: `process.memoryUsage().rss` vs 2GB
- Disk: worktree folder size via `du -s`
- Tokens: delegates to token-budget `shouldCheckpoint`

Returns health status per session with recommended action (`continue | checkpoint | kill`).

- [ ] **Step 3: Run tests; expect PASS**

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: health monitor with stall detection and resource checks"
```

---

## Task 14: DAG schema + Decomposer

**Files:**

- Create: `src/core/dag-schema.ts`
- Modify: `src/core/decomposer.ts`
- Test: `tests/unit/core/dag-schema.test.ts`
- Test: `tests/unit/core/decomposer.test.ts`

- [ ] **Step 1: Write failing tests for DAG Zod schema**

Validate: TaskNode fields (id, repo, branch, description, complexity union, context_filter array, estimated_tokens, retry_policy), DependencyEdge (from, to, type union), WorkItemDAG (title, tasks, edges). Test invalid complexity value rejects. Test defaults for retry_policy per complexity.

- [ ] **Step 2: Run test; expect FAIL**

- [ ] **Step 3: Implement `dag-schema.ts`**

```typescript
import { z } from "zod";

const retryPolicySchema = z.object({
  max_attempts: z.number().int().default(3),
  backoff: z
    .union([z.literal("linear"), z.literal("exponential")])
    .default("linear"),
  escalate_model_on_retry: z.boolean().default(true),
  on_failure: z
    .union([
      z.literal("block_dependents"),
      z.literal("skip_and_continue"),
      z.literal("cancel_work_item"),
    ])
    .default("block_dependents"),
});

export const taskNodeSchema = z.object({
  id: z.string(),
  repo: z.string(),
  branch: z.string(),
  description: z.string(),
  complexity: z.union([
    z.literal("simple"),
    z.literal("medium"),
    z.literal("complex"),
  ]),
  context_filter: z.array(z.string()).default([]),
  nexus_skills: z.array(z.string()).default([]),
  mcp_servers: z.array(z.string()).default([]),
  estimated_tokens: z.number().int().nonnegative(),
  retry_policy: retryPolicySchema.optional(),
});

export const dependencyEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  type: z.union([z.literal("blocks"), z.literal("informs")]),
});

export const workItemDAGSchema = z.object({
  title: z.string(),
  tasks: z.array(taskNodeSchema).min(1),
  edges: z.array(dependencyEdgeSchema).default([]),
});

export type TaskNode = z.infer<typeof taskNodeSchema>;
export type DependencyEdge = z.infer<typeof dependencyEdgeSchema>;
export type WorkItemDAG = z.infer<typeof workItemDAGSchema>;
```

- [ ] **Step 4: Implement `decomposer.ts`** — accepts feature request text + repo context, calls model adapter to generate DAG JSON, validates with `workItemDAGSchema.parse()`, returns structured DAG. Uses MockAdapter in tests.

- [ ] **Step 5: Run tests; expect PASS**

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: DAG schema validation and decomposer"
```

---

## Task 15: Router (3-layer routing + error classifier)

**Files:**

- Create: `src/core/router.ts`
- Create: `src/core/error-classifier.ts`
- Test: `tests/unit/core/router.test.ts`
- Test: `tests/unit/core/error-classifier.test.ts`

- [ ] **Step 1: Write failing tests**

Router tests: complexity rules (simple→Qwen engine, complex→Claude delegate), keyword scoring (description containing "refactor" scores +3), budget forcing (at 85% claude usage → force Qwen), fallback chain stepping (on retry, advance to next tier).

Error classifier tests: `shouldEscalate` returns false when all attempts have same error class, returns true when error classes differ.

- [ ] **Step 2: Run test; expect FAIL**

- [ ] **Step 3: Implement `router.ts`**

```typescript
import type { ClawEngineConfig } from "../../src/config-schema.js";

interface RouteInput {
  complexity: "simple" | "medium" | "complex";
  description: string;
  fallbackChainPosition: number;
  claudeBudgetPercent: number;
}

interface RouteResult {
  model: string;
  provider: string;
  mode: "engine" | "delegate";
  reason: string;
}

export function routeTask(
  input: RouteInput,
  config: ClawEngineConfig,
): RouteResult {
  const {
    complexity,
    description,
    fallbackChainPosition,
    claudeBudgetPercent,
  } = input;
  const chain = config.models.fallback_chain;

  if (fallbackChainPosition > 0 && fallbackChainPosition < chain.length) {
    const tier = chain[fallbackChainPosition];
    return {
      model: tier.model,
      provider: tier.provider,
      mode: tier.mode,
      reason: `fallback chain position ${fallbackChainPosition}`,
    };
  }

  if (
    claudeBudgetPercent >=
    config.providers.anthropic.force_qwen_percent * 100
  ) {
    const qwenTier = chain.find((t) => t.provider === "alibaba");
    if (qwenTier) {
      return {
        model: qwenTier.model,
        provider: qwenTier.provider,
        mode: qwenTier.mode,
        reason: "claude budget exceeded, forcing alibaba",
      };
    }
  }

  if (complexity === "complex") {
    const claudeTier = chain.find((t) => t.mode === "delegate");
    if (claudeTier) {
      return {
        model: claudeTier.model,
        provider: claudeTier.provider,
        mode: claudeTier.mode,
        reason: "complex task → delegate mode",
      };
    }
  }

  if (complexity === "simple") {
    return {
      model: chain[0].model,
      provider: chain[0].provider,
      mode: chain[0].mode,
      reason: "simple task → engine mode",
    };
  }

  const score = computeKeywordScore(
    description,
    config.router.complexity_signals,
  );
  if (score > 0) {
    const claudeTier = chain.find((t) => t.mode === "delegate");
    if (claudeTier) {
      return {
        model: claudeTier.model,
        provider: claudeTier.provider,
        mode: claudeTier.mode,
        reason: `keyword score ${score} > 0 → delegate`,
      };
    }
  }

  return {
    model: chain[0].model,
    provider: chain[0].provider,
    mode: chain[0].mode,
    reason: `keyword score ${score} <= 0 → engine`,
  };
}

export function computeKeywordScore(
  description: string,
  signals: Record<string, number>,
): number {
  const lower = description.toLowerCase();
  let score = 0;
  for (const [keyword, weight] of Object.entries(signals)) {
    if (lower.includes(keyword)) {
      score += weight;
    }
  }
  return score;
}
```

- [ ] **Step 4: Implement `error-classifier.ts`**

```typescript
interface AttemptLog {
  error: string;
  model: string;
}

const ERROR_CLASSES = {
  syntax: /syntax error|unexpected token|parsing error/i,
  type: /type error|cannot find name|is not assignable/i,
  import: /cannot find module|module not found/i,
  timeout: /timeout|timed out|ETIMEDOUT/i,
  rate_limit: /rate limit|429|too many requests/i,
  auth: /unauthorized|403|forbidden|invalid api key/i,
  network: /ECONNREFUSED|ECONNRESET|ENOTFOUND/i,
} as const;

export function classifyError(error: string): string {
  for (const [cls, pattern] of Object.entries(ERROR_CLASSES)) {
    if (pattern.test(error)) return cls;
  }
  return "unknown";
}

export function shouldEscalate(attempts: AttemptLog[]): boolean {
  if (attempts.length < 2) return true;
  const errorClasses = attempts.map((a) => classifyError(a.error));
  const uniqueClasses = new Set(errorClasses);
  return uniqueClasses.size > 1;
}
```

- [ ] **Step 5: Run tests; expect PASS**

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: 3-layer router with keyword scoring and error classifier"
```

---

## Task 16: BullMQ scheduler + DAG-aware orchestration

**Files:**

- Create: `src/core/scheduler.ts`
- Modify: `src/core/session-manager.ts` (integrate with scheduler callbacks)
- Test: `tests/integration/scheduler.test.ts`

- [ ] **Step 1: Write failing integration test**

Test that: a 3-task DAG (task-1 independent, task-2 depends on task-1, task-3 depends on task-2) — task-1 runs first, task-2 starts after task-1 completes (enters MERGING_DEPENDENCY then PROVISIONING), task-3 starts after task-2. Uses MockAdapter. Verify final state: all completed. Verify BullMQ rate limiter is configured per provider.

- [ ] **Step 2: Run test; expect FAIL**

- [ ] **Step 3: Implement `scheduler.ts`**

- Uses BullMQ queues per provider (alibaba, anthropic) with rate limiters from config
- Receives DAG from decomposer, enqueues tasks with dependencies
- On task completion, checks dependents and enqueues them if all deps met
- Handles MERGING_DEPENDENCY: triggers git merge of dependency branch into dependent worktree
- Error recovery: on failure, decides retry/escalate/block based on retry_policy

- [ ] **Step 4: Run tests; expect PASS**

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: BullMQ DAG-aware scheduler with dependency resolution"
```

---

## Task 17: Storage repositories

**Files:**

- Create: `src/storage/repositories/work-items-repo.ts`
- Create: `src/storage/repositories/tasks-repo.ts`
- Create: `src/storage/repositories/telemetry-repo.ts`
- Create: `src/storage/repositories/routing-repo.ts`
- Create: `src/storage/repositories/cost-repo.ts`
- Test: `tests/integration/storage-repos.test.ts`

- [ ] **Step 1: Write failing integration test** (requires running DB)

Test: create work item, create task linked to it, insert telemetry events, insert routing history entry, query by status, query by correlation_id. Test cascading delete.

- [ ] **Step 2: Run test; expect FAIL**

- [ ] **Step 3: Implement repository functions** (using Drizzle query builder, each repo exports pure functions that take a `db` instance)

- [ ] **Step 4: Run integration test; expect PASS**

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: Drizzle repositories for all entities"
```

---

## Task 18: CLI skeleton (`claw` commands)

**Files:**

- Create: `src/cli/index.ts`
- Create: `src/cli/commands/doctor.ts`
- Create: `src/cli/commands/run.ts`
- Create: `src/cli/commands/submit.ts`
- Create: `src/cli/commands/status.ts`
- Create: `src/cli/commands/sessions.ts`
- Create: `src/cli/commands/logs.ts`
- Create: `src/cli/commands/costs.ts`
- Create: `src/cli/commands/router-stats.ts`
- Create: `src/cli/commands/cleanup.ts`
- Create: `src/cli/commands/daemon.ts`
- Create: `src/cli/commands/pause.ts`
- Create: `src/cli/commands/resume.ts`
- Create: `src/cli/commands/cancel.ts`
- Create: `src/cli/commands/retry.ts`
- Create: `src/cli/commands/approve.ts`
- Test: `tests/unit/cli/doctor.test.ts`

- [ ] **Step 1: Write failing test for `claw doctor`** — verifies it checks config, DB connection, Redis connection, and returns structured output

- [ ] **Step 2: Run test; expect FAIL**

- [ ] **Step 3: Implement CLI entry with Commander.js**

```typescript
#!/usr/bin/env node
import { Command } from "commander";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerRunCommand } from "./commands/run.js";
import { registerSubmitCommand } from "./commands/submit.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerSessionsCommand } from "./commands/sessions.js";
import { registerLogsCommand } from "./commands/logs.js";
import { registerCostsCommand } from "./commands/costs.js";
import { registerRouterStatsCommand } from "./commands/router-stats.js";
import { registerCleanupCommand } from "./commands/cleanup.js";
import { registerDaemonCommand } from "./commands/daemon.js";
import { registerPauseCommand } from "./commands/pause.js";
import { registerResumeCommand } from "./commands/resume.js";
import { registerCancelCommand } from "./commands/cancel.js";
import { registerRetryCommand } from "./commands/retry.js";
import { registerApproveCommand } from "./commands/approve.js";

const program = new Command()
  .name("claw")
  .description("Claw Engine — model-agnostic coding agent factory")
  .version("0.1.0");

registerDoctorCommand(program);
registerRunCommand(program);
registerSubmitCommand(program);
registerStatusCommand(program);
registerSessionsCommand(program);
registerLogsCommand(program);
registerCostsCommand(program);
registerRouterStatsCommand(program);
registerCleanupCommand(program);
registerDaemonCommand(program);
registerPauseCommand(program);
registerResumeCommand(program);
registerCancelCommand(program);
registerRetryCommand(program);
registerApproveCommand(program);

program.parse();
```

- [ ] **Step 4: Implement `doctor` command** — validates config, pings Postgres, pings Redis, checks `claude` binary exists, checks disk space. Outputs checkmarks/crosses.

- [ ] **Step 5: Implement `run` command** — `claw run <repo> "<prompt>"` — creates work item with single task, runs session manager directly. Options: `--model`, `--record`, `--dry-run`.

- [ ] **Step 6: Implement `submit` command** — `claw submit "<description>" --repos <r1,r2>` — creates work item, runs decomposer, passes DAG to scheduler. Options: `--dry-run`, `--issue <url>`.

- [ ] **Step 7: Implement remaining commands** as thin CLI wrappers over repository queries and scheduler actions (status, sessions, logs, costs, router-stats, cleanup, daemon start/stop, pause, resume, cancel, retry, approve).

- [ ] **Step 8: Run `claw doctor`; verify passes**

```bash
cd ~/server/apps/claw-engine && npm run claw -- doctor
```

Expected: Config OK, DB OK, Redis OK, claude binary found.

- [ ] **Step 9: Run unit test; expect PASS**

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "feat: full CLI with all commands"
```

---

## Task 19: Fastify API + SSE event stream

**Files:**

- Create: `src/server.ts`
- Create: `src/api/sse.ts`
- Create: `src/api/routes/work-items.ts`
- Create: `src/api/routes/tasks.ts`
- Create: `src/api/routes/sessions.ts`
- Create: `src/api/routes/metrics.ts`
- Create: `src/api/routes/logs.ts`
- Test: `tests/integration/api.test.ts`

- [ ] **Step 1: Write failing integration test for SSE**

Test: publish events to Redis buffer, connect SSE client, verify events received. Test `Last-Event-ID` replay. Test `/api/metrics` returns correct shape.

- [ ] **Step 2: Run test; expect FAIL**

- [ ] **Step 3: Implement SSE hub** (`src/api/sse.ts`)

Uses Redis list as circular buffer (500 events max), each event has incremental ID. On client connect: if `Last-Event-ID` header present, replay events since that ID from Redis. Then subscribe to new events via Redis pub/sub channel.

- [ ] **Step 4: Implement API routes**

- `GET /api/work-items` — list work items (pagination, status filter)
- `GET /api/work-items/:id` — work item detail with tasks
- `GET /api/tasks/:id` — task detail with telemetry
- `GET /api/sessions` — active sessions (live status)
- `GET /api/metrics` — aggregated metrics (spec section 7 shape)
- `GET /api/logs` — filterable log entries (task_id, level, search)
- `GET /api/events` — SSE stream endpoint

- [ ] **Step 5: Implement `src/server.ts`**

```typescript
import Fastify from "fastify";
import cors from "@fastify/cors";
import { loadConfig } from "./config.js";

export async function createServer() {
  const config = loadConfig();
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });

  // Register API routes
  // await app.register(apiRoutes, { prefix: "/api" })

  // Serve dashboard static files in production
  // await app.register(fastifyStatic, { root: dashboardPath, prefix: "/" })

  return { app, config };
}
```

- [ ] **Step 6: Run tests; expect PASS**

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: Fastify API with SSE event stream and Redis replay buffer"
```

---

## Task 20: MCP integration (Engine Mode tool extension)

**Files:**

- Create: `src/integrations/mcp/mcp-client.ts`
- Create: `src/integrations/mcp/schema-translator.ts`
- Modify: `src/harness/tools/tool-registry.ts` (add MCP tool registration)
- Test: `tests/unit/integrations/mcp-client.test.ts`

- [ ] **Step 1: Write failing tests** — mock MCP server discovery returning tools, verify schema translation from MCP JSON Schema to OpenAI function-calling format. Verify `filterForTask` returns only configured MCP servers for a task.

- [ ] **Step 2: Run test; expect FAIL**

- [ ] **Step 3: Implement `mcp-client.ts`**

Uses `@modelcontextprotocol/sdk` Client + StdioClientTransport. On boot: connects to each MCP server in config, calls `listTools()`, registers tools in the tool registry. On task execution: filters tools by `task.mcp_servers`. On tool call: routes to correct MCP client, calls `callTool()`, returns result.

- [ ] **Step 4: Implement `schema-translator.ts`**

Translates MCP tool schemas (JSON Schema) to:

- OpenAI function-calling format (for Alibaba/DashScope)
- Anthropic tool_use format (for Claude API, if used directly)

- [ ] **Step 5: Run tests; expect PASS**

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: MCP client for Engine Mode tool extension"
```

---

## Task 21: Integrations (GitHub, Nexus, OpenClaw alerts)

**Files:**

- Create: `src/integrations/github/client.ts`
- Create: `src/integrations/nexus/client.ts`
- Create: `src/integrations/openclaw/client.ts`
- Test: `tests/unit/integrations/github.test.ts`
- Test: `tests/unit/integrations/openclaw.test.ts`

- [ ] **Step 1: Write failing tests** — GitHub: mock `gh` CLI calls for branch creation and PR creation. OpenClaw: mock notification sending for alert rules.

- [ ] **Step 2: Run test; expect FAIL**

- [ ] **Step 3: Implement GitHub client**

```typescript
import { execSync } from "node:child_process";

export async function createPullRequest({
  repo,
  branch,
  title,
  body,
}: {
  repo: string;
  branch: string;
  title: string;
  body: string;
}): Promise<{ url: string; number: number }> {
  const output = execSync(
    `gh pr create --repo ${repo} --head ${branch} --title "${title}" --body "${body}" --json url,number`,
    { encoding: "utf-8" },
  );
  return JSON.parse(output);
}
```

- [ ] **Step 4: Implement Nexus client** — queries Nexus MCP for relevant skills based on task description, returns skill content for injection into context builder layer 5

- [ ] **Step 5: Implement OpenClaw client** — sends Telegram notifications via OpenClaw CLI for alert rules (budget high, needs review, escalation storm, disk low, high failure rate) with cooldown tracking

- [ ] **Step 6: Run tests; expect PASS**

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: GitHub, Nexus, OpenClaw integrations"
```

---

## Task 22: Dashboard (React + Vite)

**Files:**

- Create: `src/dashboard/index.html`
- Create: `src/dashboard/vite.config.ts`
- Create: `src/dashboard/tailwind.config.ts`
- Create: `src/dashboard/tsconfig.json`
- Create: `src/dashboard/src/main.tsx`
- Create: `src/dashboard/src/app.tsx`
- Create: `src/dashboard/src/lib/api.ts`
- Create: `src/dashboard/src/lib/sse.ts`
- Create: `src/dashboard/src/components/layout.tsx`
- Create: `src/dashboard/src/components/sidebar.tsx`
- Create: `src/dashboard/src/pages/dag.tsx`
- Create: `src/dashboard/src/pages/sessions.tsx`
- Create: `src/dashboard/src/pages/metrics.tsx`
- Create: `src/dashboard/src/pages/logs.tsx`
- Create: `src/dashboard/package.json`

- [ ] **Step 1: Scaffold Vite React app** with Tailwind + shadcn/ui

```bash
cd ~/server/apps/claw-engine/src/dashboard
npm create vite@latest . -- --template react-ts
npm install tailwindcss @tailwindcss/vite react-router-dom @xyflow/react recharts
npm install -D @types/react @types/react-dom
```

- [ ] **Step 2: Implement layout** — header (status bar: engine status, active sessions, Qwen/Claude split), sidebar (work items list with status dots), main area (tabbed: DAG / Sessions / Metrics / Logs), footer (disk free, uptime)

- [ ] **Step 3: Implement SSE client** (`src/dashboard/src/lib/sse.ts`) — EventSource with automatic reconnect, `Last-Event-ID` for replay, event dispatching

- [ ] **Step 4: Implement DAG page** — `@xyflow/react` graph showing task nodes with status colors, dependency edges, interactive zoom/pan. Data from `GET /api/work-items/:id`

- [ ] **Step 5: Implement Sessions page** — live session stream via SSE, shows running sessions with model, tokens used, current tool, progress

- [ ] **Step 6: Implement Metrics page** — Recharts charts: tokens per day (stacked: Alibaba vs Claude), cost per day, savings, router success rates, validation pass rates

- [ ] **Step 7: Implement Logs page** — filterable by task_id, event_type, level. Auto-scrolling with pause button

- [ ] **Step 8: Manual smoke test** — build dashboard, serve from Fastify, open `http://localhost:3004`, verify all pages render

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat: React dashboard with DAG view, sessions, metrics, logs"
```

---

## Task 23: Daemon lifecycle + startup reconciliation

**Files:**

- Create: `src/daemon.ts`
- Create: `src/core/reconcile.ts`
- Test: `tests/integration/reconcile.test.ts`

- [ ] **Step 1: Write failing integration test**

Test: create orphan worktree directory, set a task to "running" in DB, call `reconcileOnStartup()`, verify: orphan worktree removed, running task marked as "interrupted" and re-queued.

- [ ] **Step 2: Run test; expect FAIL**

- [ ] **Step 3: Implement `reconcile.ts`**

```typescript
export async function reconcileOnStartup({
  db,
  worktreesDir,
  repoPath,
  scheduler,
}: ReconcileContext): Promise<ReconcileResult> {
  const diskWorktrees = await listWorktreesOnDisk(worktreesDir);
  const activeTasks = await getActiveTaskIds(db);

  const orphans: string[] = [];
  for (const wt of diskWorktrees) {
    if (!activeTasks.has(wt.taskId)) {
      await cleanupOrphanWorktree(wt, repoPath);
      orphans.push(wt.taskId);
    }
  }

  const interrupted: string[] = [];
  const runningTasks = await getTasksByStatus(db, "running");
  for (const task of runningTasks) {
    await markInterrupted(db, task.id);
    await scheduler.requeue(task.id);
    interrupted.push(task.id);
  }

  return { orphansRemoved: orphans.length, tasksRequeued: interrupted.length };
}
```

- [ ] **Step 4: Implement `daemon.ts`** — daemon entry point: load config, connect DB, connect Redis, run reconciliation, start scheduler, start Fastify server, register signal handlers (SIGTERM/SIGINT for graceful shutdown)

- [ ] **Step 5: Run tests; expect PASS**

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: daemon lifecycle with startup reconciliation"
```

---

## Task 24: Cleanup + retention + `claw cleanup` + `claw doctor` final

**Files:**

- Modify: `src/cli/commands/cleanup.ts`
- Modify: `src/cli/commands/doctor.ts`
- Create: `src/core/retention.ts`
- Test: `tests/unit/core/retention.test.ts`

- [ ] **Step 1: Write failing test for retention logic** — verify heartbeat events older than 14 days are deleted, tool call events older than 90 days are deleted, cost_snapshots are preserved

- [ ] **Step 2: Run test; expect FAIL**

- [ ] **Step 3: Implement `retention.ts`**

- [ ] **Step 4: Finalize `claw cleanup --dry-run`** — shows what would be cleaned: orphan worktrees, old telemetry, merged branches. Without `--dry-run`: executes cleanup.

- [ ] **Step 5: Finalize `claw doctor`** — comprehensive checks: config valid, DB connected, Redis connected, `claude` binary found, disk space > 20GB, no orphan worktrees, BullMQ queues healthy, MCP servers reachable

- [ ] **Step 6: Run tests; expect PASS**

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: cleanup, retention, and comprehensive doctor command"
```

---

## Task 25: Router learning loop

**Files:**

- Modify: `src/core/router.ts`
- Create: `src/core/learning-loop.ts`
- Test: `tests/unit/core/learning-loop.test.ts`

- [ ] **Step 1: Write failing test** — given routing_history entries showing Qwen succeeds 90% for "crud" tasks and 30% for "refactor" tasks, verify learning loop adjusts scoring weights

- [ ] **Step 2: Run test; expect FAIL**

- [ ] **Step 3: Implement `learning-loop.ts`**

Queries `routing_history` for the last 7 days, groups by task_pattern + model, computes success rates. For patterns where a non-default model outperforms, adjusts the router's keyword scoring as a bonus/penalty overlay. No ML — just statistics.

- [ ] **Step 4: Run tests; expect PASS**

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: router learning loop based on routing history statistics"
```

---

## Task 26: LaunchAgent + CLAUDE.md updates + deployment

**Files:**

- Create: `~/Library/LaunchAgents/dev.claw-engine.server.plist`
- Modify: `~/server/CLAUDE.md` (add claw-engine to port map, Docker apps, etc.)
- Create: `~/server/apps/claw-engine/CLAUDE.md`

- [ ] **Step 1: Create LaunchAgent plist**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>dev.claw-engine.server</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/opt/node@22/bin/node</string>
        <string>/Users/macmini/server/apps/claw-engine/dist/server.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/Users/macmini/server/apps/claw-engine</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/Users/macmini/server/logs/claw-engine.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/macmini/server/logs/claw-engine.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>NODE_ENV</key>
        <string>production</string>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/opt/homebrew/opt/node@22/bin:/usr/bin:/bin</string>
    </dict>
</dict>
</plist>
```

- [ ] **Step 2: Build the project**

```bash
cd ~/server/apps/claw-engine && npm run build
```

- [ ] **Step 3: Load LaunchAgent**

```bash
launchctl load ~/Library/LaunchAgents/dev.claw-engine.server.plist
```

- [ ] **Step 4: Verify daemon running**

```bash
curl http://127.0.0.1:3004/api/metrics
```

Expected: JSON response with metrics shape.

- [ ] **Step 5: Update `~/server/CLAUDE.md`** — add claw-engine to port map (3004), Docker apps section, database table (claw_engine), user table (claw_engine)

- [ ] **Step 6: Create `~/server/apps/claw-engine/CLAUDE.md`** with project-specific context for agents working inside the claw-engine codebase

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: LaunchAgent deployment and CLAUDE.md updates"
```

---

## Task 27: Verification matrix

**Files:** none (verification only)

- [ ] **Step 1: Unit tests** — `cd ~/server/apps/claw-engine && npm test` → PASS
- [ ] **Step 2: Typecheck** — `npx tsc --noEmit` → PASS (0 errors)
- [ ] **Step 3: Integration tests** — `npm run test:integration` → PASS
- [ ] **Step 4: `claw doctor`** — `npm run claw -- doctor` → all checks PASS
- [ ] **Step 5: E2E smoke — dry run** — `npm run claw -- submit "create a hello.txt file" --repos ~/server/apps/claw-engine --dry-run` → shows DAG without executing
- [ ] **Step 6: E2E smoke — real run** — `npm run claw -- run ~/server/apps/claw-engine "create a file src/test-smoke.ts that exports a function hello() returning 'world'"` → session completes, file exists, verify with `cat`
- [ ] **Step 7: Dashboard** — open `http://192.168.1.100:3004` → pages render, SSE reconnects on refresh, metrics endpoint returns data
- [ ] **Step 8: Cleanup smoke file** — `rm ~/server/apps/claw-engine/src/test-smoke.ts`

---

## Execution handoff

Plan saved to `docs/superpowers/plans/2026-03-31-claw-engine-implementation-plan.md`.

Two execution options:

1. **Subagent-Driven (recommended)** — Use superpowers:subagent-driven-development (fresh subagent per task, review between tasks, fast iteration)
2. **Inline Execution** — Use superpowers:executing-plans (execute tasks in this session with checkpoints)

Which approach?
