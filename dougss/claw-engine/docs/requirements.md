# Claw Engine — Requirements

> What the system must do. Source: design spec (2026-03-31) + production sprint (2026-04-01).
> Last updated: 2026-04-01

---

## Overview

Claw Engine is a **model-agnostic coding agent factory**. It accepts feature requests, decomposes them into parallelizable DAG tasks, routes each task to the cheapest viable model, and manages the full lifecycle — branch creation through PR.

**Problem it solves:**

- Claude Max costs ~R$500/month with unpredictable rate limits → route 70-80% of tasks to free/cheap models
- Sequential coding sessions → true parallelism via one session per worktree
- Full CLAUDE.md (~8k tokens) loaded every session → context filtering per task (~2-5k tokens)
- Zero visibility into token consumption → live dashboard with cost/token tracking
- Sessions that die on token limit → automatic checkpoint + resume

---

## Core Requirements (Functional)

### FR-1: Feature Decomposition

- Accept feature request as free-form text via CLI (`claw submit`) or HTTP API
- Decompose into a DAG of tasks using a cheap model (Qwen)
- Each task must have: repo, branch, description, complexity, context filter, retry policy
- Dependency edges: `blocks` (hard) and `informs` (soft, passes context)
- Validate DAG with Zod schema before persisting to PostgreSQL
- If repo has no CLAUDE.md, do a repo discovery pass (`tree -L 2` + `package.json` + README) to build mini-context (~500 tokens)

### FR-2: Model Routing

- Route each task through a 3-layer decision:
  1. **Static rules**: `complexity=complex` → Claude (Delegate); `complexity=simple` → Qwen (Engine)
  2. **Keyword scoring**: configurable score table (e.g. `refactor +3`, `crud -2`); positive → Claude, negative → Qwen
  3. **Budget check**: if Claude usage > 85% of daily estimate, force Qwen + warn
- Fallback chain: Qwen 3.5-plus → DeepSeek V3 → Claude Sonnet (Delegate)
- Record routing decisions in `routing_history` for learning loop (pure statistics, no ML)
- Rate limiting via BullMQ token bucket: 8 req/min for Alibaba, configurable per provider

### FR-3: Session Management

- Provision a git worktree per task at `~/.worktrees/<task-id>/`
- Run `npm ci` in worktree before starting session (no node_modules symlinks)
- Merge dependency branches into worktree before starting (if task has `blocks` edges)
- Manage full session lifecycle: PENDING → PROVISIONING → STARTING → RUNNING → {CHECKPOINTING | VALIDATING | STALLED | FAILED | COMPLETED}
- Health checks every 30s: stall detection (Engine: 60s, Delegate: 300s), memory < 2GB, disk < 5GB
- On daemon restart: reconcile orphaned worktrees and re-queue interrupted tasks

### FR-4: Agent Harness

- Run agentic loop for Engine Mode (Qwen/Alibaba/OpenAI-compat API) and Delegate Mode (claude -p subprocess)
- Support 9 built-in tools: `bash`, `read_file`, `write_file`, `edit_file`, `glob`, `grep`, `ask_user`, `web_fetch`, `web_search`
- Tool permissions: read-only tools always allowed; write tools allowed within workspace; bash allows safe commands, denies destructive patterns
- Build system prompt in 6 layers: identity, tools, task context, project context (CLAUDE.md filtered), Nexus skills, checkpoint summary (if resume)
- Total system prompt budget: 2000-5500 tokens (vs 8000+ for Claude Code)
- Auto-load project context files: `CLAUDE.md`, `AGENTS.md`, `.claude/settings.json`, `.cursor/rules/` from target repo (Task 11 ✅)
- Limit total auto-loaded context to 10KB (truncate with notice)

### FR-5: Token Budget + Checkpoint/Resume

- Track tokens per turn (heuristic: `len/4 + 1`)
- Warning at 75% of model context limit
- Checkpoint at 85%: ask model to summarize, save summary + git diff + 4 recent messages to PostgreSQL
- Compaction at 70% (before checkpoint): clear old tool results without full API call
- Microcompact: replace stale tool results (older than last 5) with `[Tool result cleared — stale]`
- On session end with reason `checkpoint`: auto-resume (max 5 times) by loading saved state into a new session

### FR-6: Retry and Resilience

- Wrap all model adapter calls with exponential backoff retry
- Retry on: 429, 500/502/503, network errors (ECONNRESET, ETIMEDOUT)
- Honor `Retry-After` header
- Backoff: 500ms base, 2x multiplier, max 32s, max 10 retries
- After retry exhaustion for a tier: escalate to next model in fallback chain
- Emit `api_retry` and `model_fallback` events for dashboard visibility
- Escalation storm prevention: if same error class across multiple models → `NEEDS_HUMAN_REVIEW`

### FR-7: Post-Completion Validation

- After agent session completes, run stack-specific validation:
  - TypeScript: `npx tsc --noEmit`, `npm run lint`, `npm test`
  - Python: `mypy .`, `ruff check .`, `pytest`
- On validation failure: re-inject errors into agent, retry max 2 times
- On persistent failure: mark task as `NEEDS_HUMAN_REVIEW`

### FR-8: GitHub Integration

- Create feature branch per task (via `gh` CLI)
- Create PR on task completion (if `config.github.auto_create_pr = true`)
- PR includes: task description, model used, token count, validation results

### FR-9: CLI

- `claw submit "<feature>" --repos <r1,r2>` — submit multi-task DAG
- `claw run <repo> "<prompt>"` — single task, stream events to stdout
- `claw status [id]` — list all active sessions or show detailed session info
- `claw sessions` — list saved sessions from DB
- `claw resume <id>` — resume a checkpointed session
- `claw cancel <id>` — cancel active session, clean up worktree
- `claw pause/retry/logs/costs/router-stats/cleanup/doctor/approve/daemon` — additional commands

### FR-10: HTTP API + Dashboard

- Fastify HTTP server on port 3004
- SSE endpoint for live event streaming with Redis replay buffer
- REST routes: work items, tasks, sessions, metrics, logs
- `POST /api/v1/run` + `GET /api/v1/tasks/:id/stream` for remote submission
- React dashboard: DAG visualization (@xyflow), live session stream, cost/token charts (Recharts), filterable log viewer

### FR-11: Observability

- Correlation ID per work item propagates to all tasks, sessions, and events
- Metrics endpoint: sessions, tokens, cost, router stats, validation rates, health
- Telegram alerts via OpenClaw for: high Claude budget, tasks needing review, escalation storms, low disk, high failure rate

### FR-12: MCP Integration

- Inject Nexus skills via MCP into system prompt (semantic search)
- Inherit MCP server config from `~/.claude/settings.json` (configurable via `inherit_from`)
- Make all MCP tools available to agent via `mcpCallTool` in session

### FR-13: Agentic Capabilities (production sprint)

- Agent can create/enter/exit git worktrees as tools (`enter_worktree`, `exit_worktree`)
- Agent can spawn sub-agents via `spawn_agent` tool (max 3 concurrent)
- Agent can manage its own tasks via `task_create/list/update/get` tools
- Concurrent-safe tools run in parallel within a turn (read_file, glob, grep, web_fetch, web_search)
- Tool result size limiting (bash: 100k chars, grep: 50k, web_fetch: 51.2k)
- Jupyter notebook editing via `notebook_edit` tool

---

## Non-Functional Requirements

| Requirement         | Target                                                       |
| ------------------- | ------------------------------------------------------------ |
| Parallelism         | Up to 3 concurrent sessions (configurable)                   |
| Token efficiency    | 70-80% of tasks routed to cheap/free models                  |
| Context size        | System prompt under 5500 tokens per session                  |
| Resilience          | Auto-resume after checkpoint, auto-retry on transient errors |
| Session persistence | Survive daemon restart via PostgreSQL                        |
| Stall detection     | Engine: 60s, Delegate: 300s                                  |
| Memory per session  | < 2GB RSS                                                    |
| Disk per worktree   | < 5GB                                                        |
| Dashboard latency   | SSE streaming, Redis buffer for reconnect                    |

---

## Out of Scope

- **Not a Claude Code replacement**: Delegate Mode uses Claude Code as an execution engine
- **Not a clone of Claude Code**: this is an orchestrator that manages coding agent instances
- **No ML**: routing decisions use statistics and heuristics only
- **No multi-user**: single-owner system, single Telegram account
- **No cloud deployment**: runs on Mac Mini homelab, port 3004, local Redis + Postgres
- **claw-code reference only**: openclaude/claw-code is a knowledge base (ingested into Nexus), not a runtime dependency
