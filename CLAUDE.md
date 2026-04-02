# CLAUDE.md — Claw Engine

> Model-agnostic coding agent factory. Routes tasks to the right model, executes via
> delegate subprocess (opencode or claude -p), tracks everything in DB + SSE dashboard.

## Stack

- **Runtime:** Node.js 22 (Homebrew node@22), TypeScript ESM (`"type": "module"`, `.js` imports)
- **API:** Fastify 5 + @fastify/cors + @fastify/static (port 3004)
- **Queue:** BullMQ 5 + Redis (127.0.0.1:6379)
- **DB:** PostgreSQL 16 via Drizzle ORM (database: `claw_engine`, user: `claw_engine`)
- **CLI:** Commander.js — `npm run claw -- <command>`
- **Dashboard:** React 19 + Vite + Tailwind v4 + @xyflow/react + Recharts

## Execution Model — Delegate Mode Only

Claw Engine **only** uses Delegate Mode. There is no engine/direct API mode.

| Provider    | When                | Binary                                                          |
| ----------- | ------------------- | --------------------------------------------------------------- |
| `opencode`  | simple/medium tasks | `opencode run --format json --model dashscope/qwen3-coder-plus` |
| `anthropic` | complex tasks       | `claude -p --output-format stream-json`                         |

Both providers have **Nexus MCP configured natively** — agents call it themselves.
DashScope API is used only for **task classification** (`classifyTask` — ~50 tokens).

## Key architecture files

| File                                         | Purpose                                                                       |
| -------------------------------------------- | ----------------------------------------------------------------------------- |
| `src/core/router.ts`                         | Routes by complexity → provider. simple/medium→opencode, complex→anthropic    |
| `src/core/classifier.ts`                     | classifyTask() — Qwen3 via DashScope, ~50 tokens, 8s timeout, fallback=medium |
| `src/integrations/opencode/opencode-pipe.ts` | Spawns opencode, parses JSONL stream → HarnessEvents                          |
| `src/integrations/claude-p/claude-pipe.ts`   | Spawns claude -p, parses stream-json → HarnessEvents                          |
| `src/cli/commands/run.ts`                    | `claw run <repo> <prompt>` — classify → route → delegate → commit             |
| `src/api/routes/run-api.ts`                  | `POST /api/v1/run` + `GET /api/v1/tasks/:id/stream` — HTTP remote submission  |
| `src/storage/repositories/`                  | Drizzle repos: work-items, tasks, telemetry, routing, cost                    |
| `src/api/sse.ts`                             | Global SSE channel via Redis pub/sub                                          |
| `src/server.ts`                              | Fastify HTTP + SSE + static dashboard                                         |
| `src/core/scheduler.ts`                      | BullMQ DAG-aware orchestration                                                |
| `src/core/decomposer.ts`                     | Feature → WorkItemDAG via LLM                                                 |

## Config (config/config.yaml)

```yaml
models:
  default: "qwen3-coder-plus" # classifyTask only (DashScope)
  fallback_chain:
    - {
        model: "opencode-default",
        provider: "opencode",
        mode: "delegate",
        max_retries: 2,
      }
    - {
        model: "claude-sonnet",
        provider: "anthropic",
        mode: "delegate",
        max_retries: 1,
      }

providers:
  alibaba:
    api_key_env: "BAILIAN_SP_API_KEY"
    base_url: "https://coding-intl.dashscope.aliyuncs.com/v1"
  anthropic:
    binary: "claude"
    flags: ["-p", "--output-format", "stream-json"]
  opencode:
    binary: "opencode"
    default_model: "dashscope/qwen3-coder-plus"
```

## OpenCode JSON event format (verified)

Events come via `part` field — NOT at top level:

```
step_start  → part.type = "step-start"
text        → part.type = "text",        part.text = "..."
tool_use    → part.type = "tool",        part.tool = "read", part.state.input = {...}
step_finish → part.type = "step-finish", part.tokens = { input, output, total }
error       → error.data.message / error.name
```

## HarnessEvent types (harness/events.ts)

`session_start` | `text_delta` | `tool_use` | `token_update` | `session_end`

## Telemetry (session_telemetry table)

Events stored per task: `routing_decision`, `tool_use`, `token_update`, `session_end`
Visible in dashboard under Session Telemetry Stream.

## Pipeline Phases — PLANNED (next implementation)

The current `claw run` is a single delegate call. The planned evolution:

```
1. PLAN    → claude -p + Nexus MCP (nexus_list + nexus_get skills)
             Produces structured plan before touching code
2. EXECUTE → opencode (implements based on plan)
3. VALIDATE→ lint + tests (execSync, retry on failure)
4. REVIEW  → claude -p (reviews the diff)
5. PR      → gh pr create (with review summary as body)
```

Each phase is a separate function. Status visible per-phase in dashboard.
**This is not yet implemented** — see GitHub issues for tracking.

## Conventions

- **RORO**: functions with 3+ params use `{ param1, param2, ... }` objects
- **No enums**: use `const OBJ = { ... } as const` + `typeof OBJ[keyof typeof OBJ]`
- **No classes** unless required by library (BullMQ, Fastify)
- **Tests**: Vitest — unit in `tests/unit/`, integration in `tests/integration/`
- **DB lazy singleton**: `getDb({ connectionString })` — call once, reuses pool
- **Best-effort DB**: wrap DB calls in try/catch, never fail the run because of DB

## Development

```bash
# Run tests
npm test                              # unit tests (203 tests)
npm run test:integration              # integration tests (needs DB + Redis)

# Type checking
npx tsc --noEmit

# CLI — requires BAILIAN_SP_API_KEY in env
source ~/.openclaw/secrets/.env
npm run claw -- run <repo> "<prompt>"   # single task
npm run claw -- run . "<prompt>" --no-commit  # without auto-commit
npm run claw -- status                  # list active work items
npm run claw -- doctor                  # health checks

# Build
npm run build                           # tsc + dashboard build
```

## Environment variables

| Var                            | Required      | Description                                                          |
| ------------------------------ | ------------- | -------------------------------------------------------------------- |
| `CLAW_ENGINE_DATABASE_URL`     | no            | Postgres connection string (overrides config)                        |
| `CLAW_ENGINE_CONFIG`           | no            | Path to config.yaml                                                  |
| `BAILIAN_SP_API_KEY`           | yes           | DashScope API key (classification + opencode via dashscope provider) |
| `CLAW_GITHUB_APP_ID`           | pipeline + PR | GitHub App ID — enables bot-attributed commits/PRs via the pipeline  |
| `CLAW_GITHUB_INSTALLATION_ID`  | pipeline + PR | Installation ID of the app on the target repo                        |
| `CLAW_GITHUB_PRIVATE_KEY_PATH` | pipeline + PR | Absolute path to the GitHub App private key (.pem)                   |
| `CLAW_GITHUB_BOT_USER_ID`      | no            | GitHub bot user numeric ID — builds the correct noreply commit email |

**Key**: `BAILIAN_SP_API_KEY` is in `~/.openclaw/secrets/.env`. Source it before running.

GitHub App vars are optional — only needed when running `--pipeline --pr` and wanting commits attributed to `claw-engine[bot]`. See `.env.example` for setup instructions.

## Port

**3004** (port 3003 is Excalidraw Canvas Server)

## Database

- DB: `claw_engine`, User: `claw_engine`, Password: `claw_engine_local` (dev)
- Tables: `work_items`, `tasks`, `session_telemetry`, `routing_history`, `cost_snapshots`

## LaunchAgent

```bash
launchctl load ~/Library/LaunchAgents/dev.claw-engine.server.plist
launchctl list | grep claw-engine
tail -f ~/server/logs/claw-engine.log
launchctl unload ~/Library/LaunchAgents/dev.claw-engine.server.plist
```
