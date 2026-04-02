# Claw Engine — Production Sprint Plan

> Generated: 2026-04-01
> Based on: openclaude deep-dive analysis + claw-engine gap analysis
> Scope: 3-week sprint to make claw-engine a real production agent factory

---

## Architecture Reference: What We Learned from openclaude

### Key Patterns to Adopt

1. **Two-layer loop**: `QueryEngine` (session owner) wraps `queryLoop()` (inner while-true). We have this via `QueryEnginePort` → `runAgentLoop`. Good.

2. **Multi-strategy compaction pipeline**: openclaude has 4 tiers — microcompact (clear old tool results) → snip compact (surgical removal) → session memory compact (background summary) → full API compact. We only have Tier 4 (full API compact). Missing Tiers 1-3 means we burn tokens on stale tool results.

3. **Retry with exponential backoff + model fallback**: openclaude's `withRetry()` is a generator that retries up to 10x with backoff, escalates 8k→64k on output limit, and falls back Opus→Sonnet on repeated 529. Our agent loop has **zero** retry — a single transient error kills the session.

4. **Streaming tool execution**: openclaude runs tools _as they stream in_ via `StreamingToolExecutor`, with concurrent-safe tools running in parallel. We run tools sequentially after the full response arrives.

5. **Worktree-based agent isolation**: openclaude's `AgentTool` creates a git worktree per sub-agent, runs a full `claude` CLI instance inside it, and tracks it as a background task. This is the pattern we need for our "factory" use case.

6. **Task system with file-based locking**: Tasks are stored as JSON files with `proper-lockfile` for concurrent swarm access. Each task has status, owner, blocking/blockedBy relationships.

7. **Permission rules with sources hierarchy**: 8 sources merged by priority — managed policy → user settings → project settings → local settings → session grants → CLI flags. We have basic regex rules only.

8. **CLAUDE.md / project context auto-loading**: openclaude reads `.claude/settings.json`, `CLAUDE.md`, `AGENTS.md` from the repo automatically. We don't.

9. **Session persistence as JSONL**: Append-only JSONL with compact boundaries and fast resume via byte-level boundary scanning. Our Postgres backend exists but is disconnected.

10. **Hook system (pre/post tool use)**: Extensible hook system for tooling customization. We don't have this.

---

## Current State (What Works)

- Router (3-tier complexity scoring, PT/EN signals)
- Engine mode Qwen (Alibaba DashScope) + Delegate mode (claude -p)
- Harness: QueryEngineConfig, TranscriptStore, UsageTracker, ToolPool, SessionStore
- Two-pass compaction (up to 10 passes)
- 9 builtin tools: bash, read_file, write_file, edit_file, glob, grep, ask_user, web_fetch, web_search
- DB storage (Drizzle ORM, 5 tables, task tracking)
- Dashboard (React/Vite at port 3004)
- Git worktree CRUD (integration layer, not exposed as tools)
- 161 unit tests + 20 integration tests

---

## What Blocks Production

### CRITICAL (blocks any real use)

1. **No API-level retry** — single transient 429/500 kills the session
2. **SessionStore Postgres disconnected** — `session-manager.ts` uses `createMemorySessionStore()`
3. **CLI `run` bypasses QueryEnginePort** — uses raw `runAgentLoop` directly, skipping compaction
4. **No auto-resume after checkpoint** — prints "checkpoint" but never resumes
5. **Error classifier, health monitor, validation runner are dead code** — exist but never called

### HIGH (needed for "factory" product)

6. **No worktree tools** — `EnterWorktree`/`ExitWorktree` for agent self-isolation
7. **No AgentTool** — can't spawn sub-agents
8. **No TaskCreate/List/Update tools** — agent can't manage its own work
9. **No fallback chain execution** — config defines 3-tier fallback but only the router picks initial model
10. **Most CLI commands are stubs** — status, resume, pause, cancel, retry

### MEDIUM (quality of life)

11. **No CLAUDE.md auto-loading** from target repos
12. **No tool result size limiting** — unbounded stdout/tool results
13. **No microcompact** (clear stale tool results without full compaction)
14. **No parallel tool execution** within a turn
15. **MCP config inheritance not wired** — `inherit_from` in config but never read

---

## Sprint Plan: 3 Weeks

### Week 1 — Production Foundation (Make claw run actually work end-to-end)

#### Task 1: withRetry wrapper for model adapters

**File**: `src/harness/model-adapters/with-retry.ts` (new)
**Tests**: `tests/unit/harness/with-retry.test.ts` (new)

Wrap any `ModelAdapter.chat()` call with retry logic:

- Exponential backoff: 500ms base, 2x multiplier, max 32s, max 10 retries
- Retry on: 429 (rate limit), 500/502/503 (server error), network errors (ECONNRESET, ETIMEDOUT)
- Honor `Retry-After` header when present
- Yield a `{ type: "api_retry", attempt, maxAttempts, delayMs, error }` event for UI feedback
- After exhausting retries for a single tier, try next model in fallback chain
- Interface:

```typescript
interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  fallbackChain?: Array<{ model: string; provider: string; mode: string }>;
}

function withRetry(adapter: ModelAdapter, config: RetryConfig): ModelAdapter;
```

**Acceptance**: Unit tests for retry logic, backoff timing, fallback chain escalation.

---

#### Task 2: Wire CLI `run` through QueryEnginePort

**File**: `src/cli/commands/run.ts` (modify)

Currently `run.ts` calls `runAgentLoop` directly — bypasses compaction, session store, and usage tracking. Change it to:

1. Create `QueryEngineConfig` from CLI args + config.yaml
2. Create `createPostgresSessionStore()` (not memory)
3. Create `QueryEnginePort` with retry-wrapped adapter
4. Call `port.run(prompt)` and stream events to stdout
5. On `session_end("checkpoint")`, auto-resume via `port.resume(sessionId)`
6. Load CLAUDE.md from target repo if it exists, prepend to system prompt

Wire the new `api_retry` event type into the event display loop.

**Acceptance**: `claw run /tmp/test-repo "fix bug"` uses QEP with compaction, retries, and Postgres session persistence.

---

#### Task 3: Add `api_retry` and `fallback` events to HarnessEvent

**File**: `src/harness/events.ts` (modify)

```typescript
| { type: "api_retry"; attempt: number; maxAttempts: number; delayMs: number; error: string }
| { type: "model_fallback"; from: string; to: string; reason: string }
```

**Acceptance**: New event types propagate through the entire event chain.

---

#### Task 4: Activate Postgres SessionStore in production

**File**: `src/core/session-manager.ts` (modify)

1. Accept `sessionStore` as parameter (dependency injection)
2. Default to `createPostgresSessionStore()` when DB connection is available
3. Fallback to `createMemorySessionStore()` if DB is unreachable (with warning)
4. Fix `createPostgresSessionStore.list()` — currently returns `[]`

**File**: `src/harness/session-store.ts` (modify)

- Implement proper `list()` for Postgres backend by querying tasks with checkpoint data

**Acceptance**: Sessions survive daemon restart. `claw sessions` lists saved sessions.

---

#### Task 5: Auto-resume after checkpoint in CLI

**File**: `src/cli/commands/run.ts` (modify)

When `session_end("checkpoint")` is received:

1. Print checkpoint summary
2. Call `port.resume(sessionId)` automatically
3. Track resume count — max 5 auto-resumes before stopping
4. Emit `{ type: "session_resume", sessionId, resumeCount }` event

Add `--no-resume` flag to disable auto-resume.
Add `--resume <sessionId>` flag to manually resume a previous session.

**Acceptance**: A long task that hits 85% context automatically compacts and resumes.

---

#### Task 6: Wire dead code — error classifier + health monitor + validation runner

**Files**: Multiple core files + `src/daemon.ts`

1. In `agent-loop.ts`: Wrap `adapter.chat()` call with try/catch, use `classifyError()` to categorize failures, decide retry vs escalate vs fail
2. In `daemon.ts`: Start periodic health check loop using `checkSessionHealth()` from `health-monitor.ts` — check for stalls, memory usage
3. In `session-manager.ts`: After agent completes successfully, call `runValidation()` if target repo has known project type (TypeScript, Python)
4. Create `src/core/orchestration-loop.ts` — the missing "glue" that ties scheduler → worktree → agent → validation → cleanup

**Acceptance**: Stalled sessions are detected and terminated. Post-completion validation runs typecheck/lint/test.

---

#### Task 7: Microcompact — clear stale tool results

**File**: `src/harness/transcript-store.ts` (modify)

Add `microcompact()` method inspired by openclaude:

- When messages exceed a threshold (e.g., 20), clear tool result content older than the last N messages (keep 5 most recent)
- Replace cleared content with `"[Tool result cleared — stale]"`
- Don't trigger full API compaction
- Call `microcompact()` at the start of each pass in `orchestrate()` BEFORE the model call

**Acceptance**: Stale tool results are cleared without API call, reducing token usage.

---

### Week 2 — Agentic Capabilities (Make it a real "factory")

#### Task 8: WorktreeTool — EnterWorktree + ExitWorktree

**Files**: `src/harness/tools/builtins/worktree.ts` (new), `tests/unit/harness/worktree-tool.test.ts` (new)

Two tools that let the agent manage its own isolation:

**`enter_worktree`**:

- Input: `{ name: string; branch?: string; repo?: string }`
- Creates a git worktree via existing `integrations/git/worktrees.ts`
- Updates `ToolContext.workspacePath` to the worktree path
- Returns the worktree path

**`exit_worktree`**:

- Input: `{ action: "keep" | "remove" }`
- Restores `ToolContext.workspacePath` to original
- If "remove", calls `removeWorktree()`
- Returns status

Register both in tool-registry and add to `TOOL_PROFILES.full`.

**Acceptance**: Agent can create, work in, and clean up worktrees autonomously.

---

#### Task 9: AgentTool — spawn sub-agents

**File**: `src/harness/tools/builtins/agent-tool.ts` (new), `tests/unit/harness/agent-tool.test.ts` (new)

Allows the orchestrator agent to delegate work to a sub-agent:

**`spawn_agent`**:

- Input: `{ prompt: string; workspacePath?: string; worktree?: string; model?: string; maxTurns?: number; background?: boolean }`
- Creates a new `QueryEnginePort` with its own config
- If `worktree` specified, creates/enters a worktree first
- If `background: true`, runs the agent in background and returns a task ID
- If `background: false` (default), runs inline and returns the agent's final output
- Sub-agent inherits parent's tools, permissions, MCP config
- Sub-agent gets its own transcript and session store

Limit: max 3 concurrent sub-agents. Track via a module-level `Map<string, Promise>`.

**Acceptance**: Orchestrator agent can delegate "fix tests in /api" to a sub-agent running in a worktree.

---

#### Task 10: TaskCreate / TaskList / TaskUpdate / TaskGet tools

**Files**: `src/harness/tools/builtins/task-tools.ts` (new), `tests/unit/harness/task-tools.test.ts` (new)

Internal task management for the agent — uses DB or in-memory store:

**`task_create`**: `{ subject: string; description?: string; status?: string }` → `{ id, subject, status }`
**`task_list`**: `{ status?: string }` → array of tasks
**`task_update`**: `{ id: string; status?: string; description?: string }` → updated task
**`task_get`**: `{ id: string }` → full task details

Storage: Use existing Drizzle `tasks` table. Agent's session ID is the parent context.

Register all 4 in tool-registry and add to `TOOL_PROFILES.full`.

**Acceptance**: Agent can create sub-tasks, track progress, mark completion.

---

#### Task 11: CLAUDE.md and project context auto-loading

**File**: `src/harness/context-builder.ts` (modify)

When building the system prompt:

1. Check if `{workspacePath}/CLAUDE.md` exists → read and prepend to system prompt
2. Check if `{workspacePath}/AGENTS.md` exists → read and prepend
3. Check if `{workspacePath}/.claude/settings.json` exists → merge permission rules
4. Check if `{workspacePath}/.cursor/rules/` exists → read and prepend rule files
5. Limit total context file size to 10KB (truncate with "... truncated")

**Acceptance**: Agent running in a repo with CLAUDE.md automatically follows project conventions.

---

#### Task 12: Parallel tool execution within a turn

**File**: `src/harness/agent-loop.ts` (modify)

Currently tools execute sequentially. Adopt openclaude's pattern:

1. Classify tools as concurrent-safe or not:
   - Concurrent-safe: `read_file`, `glob`, `grep`, `web_fetch`, `web_search`
   - Non-concurrent: `write_file`, `edit_file`, `bash`, `enter_worktree`, `exit_worktree`, `spawn_agent`
2. Collect all tool_use events from a single model response
3. Partition into concurrent-safe batch + non-concurrent queue
4. Run concurrent-safe tools in `Promise.all` (max 5 parallel)
5. Run non-concurrent tools sequentially

Add `isConcurrencySafe` field to `ToolHandler` interface (default: `false`).

**Acceptance**: Multiple read_file/glob calls in one turn run in parallel instead of sequentially.

---

#### Task 13: Tool result size limiting

**File**: `src/harness/agent-loop.ts` (modify), `src/harness/tools/tool-types.ts` (modify)

1. Add `maxResultSizeChars?: number` to `ToolHandler` (default: 50000)
2. After tool execution, if `result.output.length > maxResultSizeChars`:
   - Truncate to limit
   - Append `"\n... [output truncated at ${maxResultSizeChars} chars]"`
3. Specific limits:
   - `bash`: 100000 (commands can be verbose)
   - `read_file`: Infinity (model should specify ranges)
   - `grep`: 50000
   - `web_fetch`: 51200 (already handled internally, but enforce at loop level too)

**Acceptance**: Runaway bash commands don't blow up the context window.

---

### Week 3 — Usability + Polish

#### Task 14: Fallback chain execution in the agent loop

**File**: `src/harness/model-adapters/with-retry.ts` (extend from Task 1)

Complete the fallback chain from `config.yaml`:

```yaml
fallback_chain:
  - {
      model: "qwen3-coder-plus",
      provider: "alibaba",
      mode: "engine",
      max_retries: 2,
    }
  - {
      model: "qwen3-235b-a22b",
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
```

When engine mode exhausts retries:

1. Create a new adapter for the next tier
2. Emit `model_fallback` event
3. Continue the session with the new adapter (same messages/transcript)
4. If fallback chain is delegate mode, switch to `ClaudePipeAdapter`

**Acceptance**: If Qwen API is down, task automatically falls back to Qwen 235B, then to Claude delegate.

---

#### Task 15: Wire MCP config inheritance

**File**: `src/integrations/mcp/mcp-loader.ts` (new)

1. Read `config.yaml` → `mcp.inherit_from` path
2. Parse the target file (e.g., `~/.claude/settings.json`) to extract MCP server configs
3. Start MCP clients for each configured server
4. Make MCP tools available via `mcpCallTool` in `QueryEnginePort`
5. Wire into `cli/run.ts`

**Acceptance**: Tools from user's MCP servers (e.g., Nexus skills) are available to the agent.

---

#### Task 16: Complete stub CLI commands

**Files**: `src/cli/commands/status.ts`, `resume.ts`, `cancel.ts` (modify)

**`claw status [id]`**:

- Without ID: list all active sessions from DB
- With ID: show detailed session info (model, turns, token usage, events timeline)

**`claw resume <id>`**:

- Load session from Postgres session store
- Create QueryEnginePort with saved config
- Call `port.resume(sessionId)`
- Stream events to stdout

**`claw cancel <id>`**:

- Find active session by ID
- Signal abort (update DB status to "cancelled")
- Clean up any worktrees

**Acceptance**: All three commands work against real DB data.

---

#### Task 17: iMac Pro workflow — remote session support

**File**: `src/cli/commands/run.ts` (extend), `docs/remote-usage.md` (new)

Enable running claw-engine from the iMac Pro:

Option A — SSH tunnel (simplest):

```bash
# From iMac Pro:
ssh -L 3004:127.0.0.1:3004 mini
# Then in another terminal:
ssh mini "cd /Users/macmini/server/apps/claw-engine && npm run claw -- run /path/to/repo 'task'"
```

Option B — HTTP API submission:

- `POST /api/v1/run` endpoint on the existing Fastify server
- Input: `{ repo: string; prompt: string; model?: string }`
- Returns: `{ taskId: string; streamUrl: string }`
- Stream results via SSE at `GET /api/v1/tasks/:id/stream`

Implement Option B:

1. Add `POST /api/v1/run` route in `src/api/routes/` (new)
2. Add `GET /api/v1/tasks/:id/stream` SSE route
3. `claw run` can target remote: `claw run --remote mini /repo "task"`

**Acceptance**: Can submit tasks and stream results from iMac Pro.

---

#### Task 18: NotebookEditTool

**File**: `src/harness/tools/builtins/notebook-edit.ts` (new)

Jupyter notebook cell editing tool:

- Input: `{ path: string; cellIndex: number; action: "replace" | "insert" | "delete"; content?: string }`
- Parses .ipynb JSON format
- Validates cell index bounds
- Handles code cells and markdown cells
- Returns the modified cell content

Register in tool-registry and add to `TOOL_PROFILES.full`.

**Acceptance**: Agent can edit Jupyter notebooks.

---

#### Task 19: Orchestration loop — the missing glue

**File**: `src/core/orchestration-loop.ts` (new)

The end-to-end daemon loop that makes the factory work:

```
while (daemon running):
  1. Dequeue next task from BullMQ scheduler
  2. Create worktree (if configured)
  3. Load CLAUDE.md from target repo
  4. Create retry-wrapped adapter (from fallback chain)
  5. Create QueryEnginePort with Postgres session store
  6. Run agent loop, streaming events to:
     - SSE for dashboard/remote clients
     - DB for persistence
     - Telegram notification (via openclaw)
  7. On checkpoint → auto-resume
  8. On completion → run validation (typecheck/lint/test)
  9. On validation pass → create PR (if config.github.auto_create_pr)
  10. On any failure → classify error, decide retry vs escalate vs fail
  11. Clean up worktree
  12. Update DB status
  13. Notify owner via Telegram
```

This is the **single most important piece** — it connects all the individual components that already exist but have no glue.

**Acceptance**: `claw submit "add authentication to /repo"` → task appears in dashboard → agent runs in worktree → PR created → notification sent.

---

## Task Dependencies (Execution Order)

```
Week 1 (Production Foundation):
  Task 3 (events) → Task 1 (withRetry) → Task 2 (wire CLI) → Task 5 (auto-resume)
  Task 4 (Postgres SessionStore) — independent
  Task 6 (wire dead code) — independent
  Task 7 (microcompact) — independent

Week 2 (Agentic):
  Task 8 (worktree tools) → Task 9 (AgentTool, depends on worktrees)
  Task 10 (task tools) — independent
  Task 11 (CLAUDE.md loading) — independent
  Task 12 (parallel tools) — independent
  Task 13 (result size limits) — independent

Week 3 (Usability):
  Task 14 (fallback chain) — depends on Task 1
  Task 15 (MCP wiring) — independent
  Task 16 (CLI stubs) — depends on Task 4
  Task 17 (remote sessions) — depends on Task 2
  Task 18 (notebook tool) — independent
  Task 19 (orchestration loop) — depends on Tasks 1, 4, 6, 8, 10
```

## Verification at Each Milestone

**End of Week 1:**

```bash
npx vitest run                    # all tests pass
npx tsc --noEmit                  # no type errors
claw run /tmp/test-repo "fix bug" # uses QEP + retry + Postgres
claw sessions                     # shows saved session
```

**End of Week 2:**

```bash
npx vitest run                    # all tests (including new tool tests)
npx tsc --noEmit
# Agent can create worktrees, spawn sub-agents, track tasks
```

**End of Week 3:**

```bash
npx vitest run                    # all tests
npx tsc --noEmit
claw submit "implement feature"   # full e2e: DAG → worktree → agent → PR
curl http://192.168.1.100:3004/api/v1/run  # remote submission works
```

---

## Files Created/Modified Summary

### New Files (15)

- `src/harness/model-adapters/with-retry.ts`
- `src/harness/tools/builtins/worktree.ts`
- `src/harness/tools/builtins/agent-tool.ts`
- `src/harness/tools/builtins/task-tools.ts`
- `src/harness/tools/builtins/notebook-edit.ts`
- `src/integrations/mcp/mcp-loader.ts`
- `src/core/orchestration-loop.ts`
- `src/api/routes/run-api.ts`
- `tests/unit/harness/with-retry.test.ts`
- `tests/unit/harness/worktree-tool.test.ts`
- `tests/unit/harness/agent-tool.test.ts`
- `tests/unit/harness/task-tools.test.ts`
- `tests/unit/harness/notebook-edit.test.ts`
- `tests/unit/harness/microcompact.test.ts`
- `tests/integration/orchestration-loop.test.ts`

### Modified Files (12)

- `src/harness/events.ts` — add `api_retry`, `model_fallback`, `session_resume` events
- `src/harness/agent-loop.ts` — parallel tool execution, result size limiting
- `src/harness/transcript-store.ts` — add `microcompact()` method
- `src/harness/query-engine-port.ts` — call microcompact before each pass
- `src/harness/session-store.ts` — fix Postgres `list()`, accept DB connection
- `src/harness/tools/tool-types.ts` — add `isConcurrencySafe`, `maxResultSizeChars`
- `src/harness/tools/tool-registry.ts` — register new tools
- `src/harness/tool-pool.ts` — add new tools to profiles
- `src/harness/context-builder.ts` — CLAUDE.md auto-loading
- `src/core/session-manager.ts` — accept SessionStore via DI, use Postgres
- `src/cli/commands/run.ts` — QEP integration, auto-resume, remote flag
- `src/daemon.ts` — health check loop, orchestration loop startup

### Estimated Total: ~3000 LoC new code + ~500 LoC modifications + ~2000 LoC tests
