# CLAUDE.md — Claw Engine

> Model-agnostic coding agent factory. Routes tasks to the right model, executes via
> delegate subprocess (opencode or claude -p), tracks everything in DB + SSE dashboard.
> Supports both manual CLI execution and autonomous daemon-driven orchestration.

## Stack

- **Runtime:** Node.js 22 (Homebrew node@22), TypeScript ESM (`"type": "module"`, `.js` imports)
- **API:** Fastify 5 + @fastify/cors + @fastify/static (port 3004)
- **Queue:** BullMQ 5 + Redis (127.0.0.1:6379)
- **DB:** PostgreSQL 16 via Drizzle ORM (database: `claw_engine`, user: `claw_engine`)
- **CLI:** Commander.js — `npm run claw -- <command>`
- **Dashboard:** React 19 + Vite + Tailwind v4 (single-view monitor, no routing)

## Execution Modes

### 1. Manual CLI (`claw run`)

Direct execution — you run, you watch, you get results.

```bash
claw run <repo> "<prompt>"          # classify → route → branch → delegate → commit → push → PR
claw run . "<prompt>" --no-commit   # without auto-commit/branch/PR
claw run . "<prompt>" --delegate    # force claude -p
```

**Flow:** classify task (Qwen) → route to provider → create branch from main → delegate (opencode/claude -p) → commit → push → PR via `gh` → publish events to Redis SSE.

### 2. Autonomous Daemon (`claw submit`)

Submit and forget — daemon processes the queue autonomously.

```bash
claw submit "<description>" --repos <repo-path>   # enqueue task
```

**Flow:** create work item → classify → enqueue to BullMQ → daemon Worker picks up → create worktree → delegate → validate (typecheck/lint/test) → retry if failed → commit → push → PR → notify via Telegram → cleanup worktree.

**Daemon:** runs via LaunchAgent (`dev.claw-engine.server`), creates BullMQ Workers for 3 queues:

- `claw-opencode` (concurrency 3) — simple/medium tasks
- `claw-anthropic` (concurrency 1) — complex tasks
- `claw-default` (concurrency 3) — fallback

### Providers

| Provider    | When                | Binary                                                          |
| ----------- | ------------------- | --------------------------------------------------------------- |
| `opencode`  | simple/medium tasks | `opencode run --format json --model dashscope/qwen3-coder-plus` |
| `anthropic` | complex tasks       | `claude -p --output-format stream-json`                         |

Both providers have **Nexus MCP configured natively** — agents call it themselves.
DashScope API is used only for **task classification + intent title** (`classifyTask` — ~50 tokens).

## Key Architecture Files

| File                                         | Purpose                                                                      |
| -------------------------------------------- | ---------------------------------------------------------------------------- |
| `src/core/orchestration-loop.ts`             | 13-step autonomous pipeline: worktree → delegate → validate → PR → notify    |
| `src/core/router.ts`                         | Routes by complexity → provider. simple/medium→opencode, complex→anthropic   |
| `src/core/classifier.ts`                     | classifyTask() — returns complexity + intent title via Qwen3 DashScope       |
| `src/core/scheduler.ts`                      | BullMQ DAG-aware queue management (3 queues by provider)                     |
| `src/core/validation-runner.ts`              | Post-execution validation: typecheck + lint + test                           |
| `src/core/error-classifier.ts`               | Classify errors as retryable (timeout, network) or fatal (auth)              |
| `src/daemon.ts`                              | Fastify server + BullMQ Workers + health monitor                             |
| `src/cli/commands/run.ts`                    | `claw run` — manual CLI execution with branch+PR flow                        |
| `src/cli/commands/submit.ts`                 | `claw submit` — enqueue task for daemon processing                           |
| `src/integrations/opencode/opencode-pipe.ts` | Spawns opencode, parses JSONL stream → HarnessEvents + heartbeat             |
| `src/integrations/claude-p/claude-pipe.ts`   | Spawns claude -p, parses stream-json → HarnessEvents + heartbeat             |
| `src/integrations/git/worktrees.ts`          | Create/remove git worktrees for isolated execution                           |
| `src/integrations/openclaw/client.ts`        | Telegram notifications via openclaw CLI (best-effort)                        |
| `src/integrations/github/client.ts`          | PR creation via `gh` CLI                                                     |
| `src/api/sse.ts`                             | Global SSE channel via Redis pub/sub                                         |
| `src/api/routes/run-api.ts`                  | `POST /api/v1/run` + `GET /api/v1/tasks/:id/stream` — HTTP remote submission |
| `src/storage/repositories/`                  | Drizzle repos: work-items, tasks, telemetry, routing, cost                   |
| `src/server.ts`                              | Fastify HTTP + SSE + static dashboard                                        |

## Dashboard

Single-view passive monitor. No routing, no sidebar navigation.

**Layout:** Header (KPIs) + Task List (left, 320px) + Detail Pane (right, flex)

**Detail Pane (3 zones):**

1. **Header** — intent title + status badge + model + duration + "Prompt" button (opens modal)
2. **Pipeline Cards** — large clickable phase cards (only for pipeline runs), filter logs by phase
3. **Log Viewer** — clean flat entries: tool calls (accent color), text output (> prefix), token chips, inline diffs for edit/write tools

**Real-time:** SSE from Redis (CLI publishes all delegate events). Task list refreshes on SSE events (throttled 3s).

**Dashboard source:** `src/dashboard/src/` — React 19 + Vite + Tailwind v4

## Orchestration Loop (13 Steps)

The `orchestrateTask()` function in `src/core/orchestration-loop.ts`:

1. Update task status → running
2. Create git worktree (isolated workspace)
3. Load project context (CLAUDE.md)
4. Run delegate (opencode or claude -p)
5. Stream events → SSE (Redis) + DB (telemetry) + token tracking
6. Handle checkpoint if token budget hit
7. Run validation (typecheck + lint + test)
8. If validation fails + retries remain → retry with error context
9. If validation passes → git commit + push + PR
10. Classify errors (fatal vs retryable)
11. Cleanup worktree (always, via finally)
12. Update DB status + rollup work item
13. Notify via Telegram (best-effort, non-blocking)

## Config (config/config.yaml)

```yaml
engine:
  port: 3004
  worktrees_dir: "~/server/.worktrees"

sessions:
  max_parallel: 3
  stall_timeout_delegate_ms: 300000

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

validation:
  max_retries: 2
  typescript:
    - { name: "typecheck", command: "npx tsc --noEmit", required: true }
    - { name: "lint", command: "npm run lint", required: false }
    - { name: "test", command: "npm test", required: true }

github:
  auto_create_pr: true
```

## HarnessEvent Types (harness/events.ts)

`session_start` | `text_delta` | `tool_use` | `tool_result` | `token_update` | `checkpoint` | `session_end` | `heartbeat` | `phase_start` | `phase_end`

## Telemetry (session_telemetry table)

Events stored per task: `routing_decision`, `text_delta`, `tool_use`, `token_update`, `session_end`
All events visible in dashboard log viewer with semantic formatting.

## Conventions

- **RORO**: functions with 3+ params use `{ param1, param2, ... }` objects
- **No enums**: use `const OBJ = { ... } as const` + `typeof OBJ[keyof typeof OBJ]`
- **No classes** unless required by library (BullMQ, Fastify)
- **Tests**: Vitest — unit in `tests/unit/`, integration in `tests/integration/`
- **DB lazy singleton**: `getDb({ connectionString })` — call once, reuses pool
- **Best-effort DB/SSE**: wrap in try/catch, never fail the run because of DB/Redis
- **No inline styles in dashboard**: Tailwind only, use arbitrary values `text-[#hex]` when needed

## Development

```bash
# Run tests
npm test                              # unit tests (303 tests, 43 files)
npm run test:integration              # integration tests (needs DB + Redis)

# Type checking
npx tsc --noEmit

# CLI — requires BAILIAN_SP_API_KEY in env
source ~/.openclaw/secrets/.env
npm run claw -- run <repo> "<prompt>"              # manual execution
npm run claw -- run . "<prompt>" --no-commit       # without branch/PR
npm run claw -- submit "<desc>" --repos <path>     # enqueue for daemon
npm run claw -- status                             # list active work items
npm run claw -- doctor                             # health checks

# Build (backend + dashboard)
npm run build

# Dashboard dev
cd src/dashboard && npm run dev       # Vite dev server, proxy /api to :3004
```

## Environment Variables

| Var                            | Required      | Description                                                          |
| ------------------------------ | ------------- | -------------------------------------------------------------------- |
| `CLAW_ENGINE_DATABASE_URL`     | no            | Postgres connection string (overrides config)                        |
| `CLAW_ENGINE_CONFIG`           | no            | Path to config.yaml                                                  |
| `BAILIAN_SP_API_KEY`           | yes           | DashScope API key (classification + opencode via dashscope provider) |
| `CLAW_GITHUB_APP_ID`           | pipeline + PR | GitHub App ID — enables bot-attributed commits/PRs                   |
| `CLAW_GITHUB_INSTALLATION_ID`  | pipeline + PR | Installation ID of the app on the target repo                        |
| `CLAW_GITHUB_PRIVATE_KEY_PATH` | pipeline + PR | Absolute path to the GitHub App private key (.pem)                   |
| `CLAW_GITHUB_BOT_USER_ID`      | no            | GitHub bot user numeric ID — builds the correct noreply commit email |

**Key**: `BAILIAN_SP_API_KEY` is in `~/.openclaw/secrets/.env`. Source it before running.

## Port

**3004** (port 3003 is Excalidraw Canvas Server)

## Database

- DB: `claw_engine`, User: `claw_engine`, Password: `claw_engine_local` (dev)
- Tables: `work_items`, `tasks`, `session_telemetry`, `routing_history`, `cost_snapshots`

## LaunchAgent

```bash
# Production (uses dist/daemon.js — run npm run build first)
launchctl load ~/Library/LaunchAgents/dev.claw-engine.server.plist
launchctl list | grep claw-engine
tail -f ~/server/logs/claw-engine.log
launchctl unload ~/Library/LaunchAgents/dev.claw-engine.server.plist

# Development (uses tsx — no build needed, better for debugging)
source ~/.openclaw/secrets/.env
npx tsx src/daemon.ts
```

**Note:** LaunchAgent PATH must include `~/.local/bin` for claude CLI access.

## Git Workflow (claw run)

1. Creates branch `claw/<slug>-<timestamp>` from `origin/main`
2. Delegate executes on the branch
3. `git add -A && git commit` (author: clawengine[bot])
4. `git push -u origin <branch>`
5. `gh pr create` (PR author: repo owner via gh token)

## Open Issues

- **#52**: Telegram notifications failing from orchestration loop (openclaw CLI access from daemon)
