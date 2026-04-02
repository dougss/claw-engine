# Claw Engine — Design

> Architecture as it exists today. Source: design spec + claw-code alignment plan + production sprint.
> Last updated: 2026-04-01

---

## System Overview

Claw Engine is a TypeScript daemon (port 3004) that orchestrates coding agent sessions. It receives feature requests, decomposes them into dependency-aware DAGs, routes each task to the cheapest viable model, and manages the full session lifecycle from git worktree creation through PR.

**Two execution modes:**

- **Engine Mode** — harness controls everything (tools, context, permissions, agentic loop) for Qwen/Alibaba/any OpenAI-compat model
- **Delegate Mode** — spawns `claude -p` as a subprocess; Claude Code owns execution while Claw Engine monitors tokens and manages checkpoint

**Inspired by:** [claw-code](https://github.com/instructkr/claw-code) patterns (QueryEnginePort, TranscriptStore, SessionStore, ToolPool) adapted for multi-session orchestration.

---

## Components

### `src/daemon.ts` — Entry Point

Starts server, loads config, runs startup reconciliation, registers signal handlers.

### `src/server.ts` — HTTP Server

Fastify 5 server serving REST API, SSE hub, and static React dashboard. Port 3004.

### `src/core/scheduler.ts` — DAG Orchestrator

BullMQ-backed queue that respects DAG dependency edges. Dispatches tasks to session-manager only when all `blocks` predecessors have completed. Rate-limited per provider.

### `src/core/decomposer.ts` — Feature → DAG

Sends feature request to cheap model (Qwen). Returns validated `WorkItemDAG`. Optionally does repo discovery (tree, package.json, README) if no CLAUDE.md found.

### `src/core/router.ts` — Model Selection

3-layer routing: static complexity rules → keyword scoring → budget check. Records every decision in `routing_history`. Enforces fallback chain when primary model fails.

### `src/core/session-manager.ts` — Session Lifecycle

Manages a single task's lifecycle. Creates worktree, provisions dependencies, builds system prompt via ContextBuilder, creates adapter, runs QueryEnginePort, runs validation. Uses Postgres SessionStore (injected via DI, fallback to memory).

### `src/core/reconcile.ts` — Startup Reconciliation

On boot: compares disk worktrees vs DB active tasks; cleans up orphans; re-queues interrupted sessions.

### `src/harness/agent-loop.ts` — Inner Agentic Loop

`runAgentLoop()` — streams prompt → model → tool execution → result → model in a tight loop. Yields `HarnessEvent` stream. Max 16 iterations per pass. Tools execute sequentially within a turn.

### `src/harness/query-engine-port.ts` — Session Orchestrator

Wraps `runAgentLoop` with compaction, session persistence, and checkpoint logic. Calls `microcompact()` before each pass at 70% usage, triggers full compaction (up to 10 passes) at 70%, checkpoints at 85%.

### `src/harness/context-builder.ts` — System Prompt Builder

Builds system prompt in 6 layers: identity → tools → task context → project context → Nexus skills → checkpoint summary. Auto-loads `CLAUDE.md`, `AGENTS.md`, `.claude/settings.json`, `.cursor/rules/` from target repo (Task 11 ✅). Total budget: 2000-5500 tokens.

### `src/harness/transcript-store.ts` — Conversation History

Append-only conversation transcript with `microcompact()` (clears stale tool results in-place) and full compaction (calls model to summarize).

### `src/harness/session-store.ts` — Session Persistence

Save/load/list/delete session state. Two backends: `createMemorySessionStore()` and `createPostgresSessionStore()`.

### `src/harness/query-engine-config.ts` — Centralized Config

Single typed config object for a session: `maxTurns`, `maxTokens`, `compactionThreshold` (0.70), `checkpointThreshold` (0.85), `warningThreshold` (0.75), `toolProfile`, `reserveForSummary` (10k), `compactionEnabled`.

### `src/harness/usage-tracker.ts` — Token Accounting

Per-turn aggregation of input tokens, output tokens, tool calls, denied tools.

### `src/harness/tool-pool.ts` — Tool Assembly

Assembles tool sets by profile: `full` (all 9 tools), `readonly` (read_file, glob, grep), `minimal`. Supports custom tool injection.

### `src/harness/model-adapters/`

- `alibaba-adapter.ts` — DashScope API (Qwen 3.5+, Kimi K2.5, DeepSeek V3) via OpenAI-compat endpoint
- `claude-pipe-adapter.ts` — wraps `claude -p` subprocess, parses streaming output
- `mock-adapter.ts` — scripted responses for unit tests
- `recorded-adapter.ts` — playback of recorded sessions

### `src/harness/tools/builtins/` — 9 Built-in Tools

`bash`, `read_file`, `write_file`, `edit_file`, `glob_tool`, `grep_tool`, `ask_user`, `web_fetch`, `web_search`

### `src/integrations/`

- `git/worktrees.ts` — CRUD for git worktrees
- `github/client.ts` — branch + PR creation via `gh` CLI
- `nexus/client.ts` — skill injection via MCP
- `openclaw/client.ts` — Telegram alerts via OpenClaw gateway
- `mcp/mcp-client.ts` — discover and execute MCP tools
- `mcp/schema-translator.ts` — MCP → provider tool schema translation

### `src/storage/`

- `db.ts` — Drizzle lazy singleton `getDb()`
- `schema/` — 5 tables: `work_items`, `tasks`, `session_telemetry`, `routing_history`, `cost_snapshots`
- `repositories/` — typed repo functions per table

### `src/dashboard/` — React App

React 19 + Vite + Tailwind v4 + @xyflow/react + Recharts. Pages: DAG visualization, live session stream (SSE), metrics charts, log viewer.

---

## Data Model

### `work_items`

Top-level feature request. Has `id`, `title`, `description`, `status`, `correlation_id`.

### `tasks`

Individual DAG node. Has `work_item_id`, `repo`, `branch`, `description`, `complexity`, `status`, `model_used`, `provider`, `mode`, `token_count`, `checkpoint_data` (JSONB), `retry_count`.

**Task statuses:** `pending` → `running` → `completed` | `failed` | `needs_review` | `interrupted`

### `session_telemetry`

Per-turn events for a task session. `task_id`, `event_type`, `payload` (JSONB), `timestamp`.

### `routing_history`

Router decision log. `task_id`, `complexity`, `model_chosen`, `provider`, `keyword_score`, `budget_percent`, `outcome` (success/fail), `created_at`.

### `cost_snapshots`

Daily cost aggregation. `date`, `provider`, `input_tokens`, `output_tokens`, `cost_usd`.

---

## Key Flows

### Submit → DAG → Execution

```
claw submit "add OAuth" --repos finno
  → Decomposer: prompt → Qwen → WorkItemDAG JSON → Zod validate → DB
  → Scheduler: poll for ready tasks (no blocking deps)
  → Router: complexity + keywords + budget → model + mode
  → SessionManager: create worktree, run npm ci, build system prompt
  → QueryEnginePort.run(prompt):
      → Context Builder (6 layers, 2-5k tokens)
      → [loop]: model call → tool execution → token check
        → at 70%: microcompact (clear stale tool results)
        → at 70%: transcript compaction (up to 10 passes)
        → at 85%: checkpoint (save to DB, end session)
  → On checkpoint: auto-resume (max 5 times)
  → On completion: run validation (typecheck, lint, test)
  → On validation pass: create PR via gh CLI
  → Send Telegram notification via OpenClaw
```

### Checkpoint/Resume

```
usedTokens / maxContext >= 0.85
  → inject summary prompt into agent
  → model generates summary
  → save: summary + git diff + 4 recent messages → tasks.checkpoint_data (JSONB)
  → session ends with reason "checkpoint"
  → new session starts with checkpoint summary as Layer 6 of Context Builder
```

### Router Decision

```
task.complexity == "complex"  → Claude, Delegate Mode
task.complexity == "simple"   → Qwen, Engine Mode
task.complexity == "medium":
  score = sum(COMPLEXITY_SIGNALS[keyword] for keyword in task.description)
  score > 0 → Claude  |  score <= 0 → Qwen
  budget > 85% → force Qwen regardless
```

---

## Design Decisions

### Port 3004 (not 3003)

Design spec originally said 3003, but that port is taken by Excalidraw Canvas Server. Config and LaunchAgent use 3004.

### ESM + `.js` import extensions

TypeScript ESM with `"type": "module"` in package.json. All local imports use explicit `.js` extensions (matches Nexus/Harness conventions).

### No classes (except library APIs)

No class syntax except where required by BullMQ or Fastify. Functions with 3+ params use RORO (Receive Object, Return Object) pattern.

### No enums

`const OBJ = { ... } as const` + `typeof OBJ[keyof typeof OBJ]` for union types.

### DB lazy singleton

`getDb({ connectionString })` initializes once, reuses connection pool. Matches Nexus pattern.

### QueryEnginePort wraps runAgentLoop

`QueryEnginePort` is the orchestrator that handles compaction, persistence, and checkpoint. `runAgentLoop` is the inner loop that handles a single model call cycle. This separation came from claw-code alignment: the port layers compaction/persistence on top of events yielded by the loop — no structural changes to the loop itself.

### Compaction before Checkpoint

Compaction (70%) triggers before checkpoint (85%): if compaction succeeds, the session continues; if it can't reclaim enough context, the session checkpoints and resumes. Compaction preserves 4 most recent messages + 10k token reserve for summarization.

### Memory SessionStore as fallback

`createPostgresSessionStore()` is the default when DB is reachable. Falls back to `createMemorySessionStore()` with a warning if DB is unreachable — sessions survive in memory but don't survive daemon restart.

### Worktree isolation

Each task gets its own git worktree at `~/.worktrees/<task-id>/`. This gives isolated file system state, git history, and branch per session. Worktrees are cleaned up after PR creation or on reconciliation.

### claw-code as knowledge base, not runtime

claw-code/openclaude is a reference architecture. Its patterns (QueryEnginePort, TranscriptStore, etc.) were extracted and reimplemented. The actual claw-code repo is ingested into Nexus as skills, not imported as a library.

### Current implementation state (2026-04-01)

What works: Router, Engine Mode (Alibaba), Delegate Mode (claude -p), full harness stack (QueryEngineConfig, TranscriptStore, UsageTracker, ToolPool, SessionStore), two-pass compaction (up to 10 passes), 9 built-in tools, DB storage (Drizzle + 5 tables), React dashboard, git worktree CRUD, 161 unit tests + 20 integration tests, CLAUDE.md/AGENTS.md/.cursor/rules auto-loading.

What's not yet wired: API-level retry, Postgres SessionStore in production (CLI uses memory), auto-resume after checkpoint, error classifier/health monitor/validation runner (dead code), worktree tools, AgentTool, TaskTools, MCP config inheritance.
