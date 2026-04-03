# Orchestration Loop — Specification

GitHub Issue: #14

## Purpose

Replace the 13 stubs in `orchestration-loop.ts` with real implementations and wire a BullMQ Worker in the daemon that continuously dequeues tasks and processes them through the full pipeline: worktree → delegate → validate → retry → PR → notify. This transforms claw-engine from a manual CLI tool into an autonomous agent factory.

## Architecture Overview

```
claw submit "feature"
  → createWorkItem (DB, status=queued)
  → decompose (LLM → WorkItemDAG)
  → enqueueDAG (BullMQ: 3 queues by provider)

daemon (always running):
  → BullMQ Worker dequeues job
  → orchestrateTask(job) — the 13-step pipeline:
      1. receiveTask         — extract job data, update DB status
      2. provisionWorkspace  — createWorktree or use repo directly
      3. loadContext          — CLAUDE.md + AGENTS.md
      4. runDelegate          — opencode/claude -p, stream events
      5. handleCheckpoint     — save state if token limit hit
      6. runValidation        — typecheck + lint + test
      7. evaluateResult       — pass → PR, fail → retry
      8. handleFailure        — classify error, retry or escalate
      9. createPR             — git push + gh pr create
      10. cleanupWorkspace    — remove worktree
      11. updateDB            — task status, tokens, validation results
      12. publishCompletion   — SSE event to dashboard
      13. notify              — Telegram via openclaw
```

## User Stories

### US-1: Submit and forget (P1)

As a developer, I want to run `claw submit "implement feature X"` and have the daemon automatically process the task end-to-end, so I can work on other things.

**Acceptance Scenarios:**

- Given I run `claw submit "add auth middleware"`, When the daemon is running, Then a work item appears in the dashboard as "queued"
- Given the daemon processes the task, When it completes successfully, Then a PR is created and I get a Telegram notification
- Given the task fails validation, When retries are configured, Then the daemon retries up to `max_retries` times before marking as failed

### US-2: Monitor via dashboard (P1)

As a developer, I want to see real-time progress of daemon-processed tasks in the dashboard, identical to CLI-initiated tasks.

**Acceptance Scenarios:**

- Given a task is being processed by the daemon, When I open the dashboard, Then I see live tool_use, text_delta, and token_update events streaming
- Given a task completes with a PR, Then the task shows the PR URL in the dashboard

### US-3: Error recovery (P2)

As a developer, When a task fails mid-execution, I want the daemon to classify the error and either retry or escalate, so tasks don't silently die.

**Acceptance Scenarios:**

- Given a delegate times out, When the error is classified as "timeout", Then the daemon retries with the same model
- Given a task fails with "auth" error, Then the daemon escalates immediately (no retry) and notifies via Telegram
- Given a task exhausts all retries, Then it's marked as "failed" in DB and a Telegram alert is sent

## Functional Requirements

### Phase 1: Worker + Execute

- **FR-001:** The daemon MUST create a global BullMQ Worker for each provider queue (alibaba, anthropic, default) on startup
- **FR-002:** Each Worker MUST call `orchestrateTask(job)` for every dequeued job
- **FR-003:** `orchestrateTask` MUST update the task status to "running" in DB immediately upon dequeue
- **FR-004:** `orchestrateTask` MUST provision a git worktree via `createWorktree()` using the task's repo path and a unique branch name
- **FR-005:** `orchestrateTask` MUST load project context via `loadProjectContext(worktreePath)`
- **FR-006:** `orchestrateTask` MUST route to the correct delegate pipe (opencode or claude -p) based on the job's provider field
- **FR-007:** For every event yielded by the delegate, `orchestrateTask` MUST:
  - Publish to Redis SSE via `publishEvent(redis, { type, data: { taskId, ...event } })`
  - Persist to DB via `insertTelemetryEvent(db, { taskId, eventType, payload })`
  - Update token counts via `updateTaskTokens()` for token_update events
- **FR-008:** If the delegate yields a `checkpoint` event, `orchestrateTask` MUST save checkpoint data via `setTaskCheckpointData()` and mark task as "checkpointing"
- **FR-009:** Max parallel sessions MUST respect `config.sessions.max_parallel` (default 3) via BullMQ Worker concurrency settings

### Phase 2: Validate + Retry + PR

- **FR-010:** After successful delegate completion, `orchestrateTask` MUST run validation via `runValidation()` with steps from `config.validation.typescript`
- **FR-011:** Validation results MUST be persisted in the task's `validationResults` field
- **FR-012:** If validation passes, `orchestrateTask` MUST:
  - `git add -A && git commit` in the worktree
  - Push the branch to origin
  - Create a PR via `gh pr create` if `config.github.auto_create_pr` is true
  - Store prUrl and prNumber in the task record
- **FR-013:** If validation fails and `task.attempt < task.maxAttempts`, `orchestrateTask` MUST:
  - Increment attempt counter
  - Re-run the delegate with a prompt that includes the validation error output
  - Re-validate after the retry
- **FR-014:** If validation fails and all retries exhausted, mark task as "failed" with validation results

### Phase 3: Error Handling + Cleanup + Notify

- **FR-020:** On any error during delegate execution, `orchestrateTask` MUST call `classifyError()` to categorize the failure
- **FR-021:** Fatal errors (auth) MUST NOT retry — mark as failed immediately
- **FR-022:** Retryable errors (timeout, rate_limit, network) MUST retry if attempts remain
- **FR-023:** After task completion (success or failure), `orchestrateTask` MUST remove the worktree via `removeWorktree()`
- **FR-024:** After task completion, `orchestrateTask` MUST update:
  - Task status (completed/failed)
  - Work item status rollup (if all tasks done → completed)
  - Work item token/cost rollup
- **FR-025:** After task completion, `orchestrateTask` MUST publish a `session_end` SSE event
- **FR-026:** After task completion, `orchestrateTask` MUST send a Telegram notification via `sendAlert()`:
  - Success: type "session_completed", message includes PR URL
  - Failure: type "session_failed", message includes error class and last error

### Submit + Decompose wiring

- **FR-030:** `claw submit` MUST call the decomposer to break the work item into a DAG of tasks
- **FR-031:** After decomposition, `claw submit` MUST call `enqueueDAG()` to queue all tasks respecting dependencies
- **FR-032:** If decomposition produces a single task (no deps), it MUST be queued immediately without the full DAG overhead

## Non-Functional Requirements

- **NFR-001:** The orchestration loop MUST be resilient to Redis/DB downtime — SSE publish and telemetry insert are best-effort (catch, log, continue)
- **NFR-002:** Worktree cleanup MUST happen in a finally block — never leak worktrees even on crash
- **NFR-003:** The Worker MUST handle graceful shutdown (SIGTERM) — finish current job, don't start new ones
- **NFR-004:** Total processing time per task SHOULD be bounded by the delegate timeout (60 min default)

## Out of Scope

- Dashboard changes (dashboard already shows events via SSE)
- New CLI commands beyond wiring `claw submit`
- Multi-repo DAG execution (single repo per task for now)
- Custom validation steps per repo (uses global config)
- Checkpoint resume (save checkpoint data but don't auto-resume yet)

## Open Questions

None — all resolved.
