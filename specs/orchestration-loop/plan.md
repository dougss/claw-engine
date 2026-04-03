# Orchestration Loop — Implementation Plan

**Goal:** Wire the 13-step orchestration pipeline and BullMQ daemon worker so `claw submit` → task queued → agent runs → validated → PR created → Telegram notification.
**Architecture:** Rewrite `orchestration-loop.ts` stubs with real implementations that call existing components. Add BullMQ Workers to `daemon.ts`. Wire `claw submit` to decomposer + scheduler.
**Tech Stack:** Node.js 22, TypeScript ESM, BullMQ 5, ioredis, Drizzle ORM, Fastify.
**Spec:** specs/orchestration-loop/spec.md
**Plan:** specs/orchestration-loop/plan.md

**REQUIRED SUB-SKILL:** nexus:subagent-driven-development (Tasks 1-3 parallel, then 4 sequential)

---

## File Map

### Rewrite

- `src/core/orchestration-loop.ts` — 13 stubs → real pipeline

### Modify

- `src/daemon.ts` — add BullMQ Workers on startup
- `src/cli/commands/submit.ts` — wire decomposer + enqueueDAG

### Create

- `tests/unit/core/orchestration-loop.test.ts` — unit tests for the pipeline

### No Changes (used as-is)

- `src/core/scheduler.ts` — enqueueDAG, queues
- `src/core/validation-runner.ts` — runValidation
- `src/core/error-classifier.ts` — classifyError, shouldEscalate
- `src/core/health-monitor.ts` — checkSessionHealth
- `src/harness/context-builder.ts` — loadProjectContext
- `src/integrations/opencode/opencode-pipe.ts` — runOpencodePipe
- `src/integrations/claude-p/claude-pipe.ts` — runClaudePipe
- `src/integrations/git/worktrees.ts` — createWorktree, removeWorktree
- `src/integrations/openclaw/client.ts` — sendAlert
- `src/integrations/github/client.ts` — createPullRequest, createBranch
- `src/api/sse.ts` — publishEvent
- `src/storage/repositories/*.ts` — all repo functions

---

## Tasks

### Task 1: Rewrite orchestration-loop.ts — the 13-step pipeline

**Files:**

- Rewrite: `src/core/orchestration-loop.ts`

**Steps:**

- [ ] Step 1: Read the current stub file completely to understand the 13 function signatures
- [ ] Step 2: Read the spec at `specs/orchestration-loop/spec.md`
- [ ] Step 3: Read existing components that will be called:
  - `src/integrations/git/worktrees.ts` — createWorktree, removeWorktree signatures
  - `src/integrations/opencode/opencode-pipe.ts` — runOpencodePipe signature + options
  - `src/integrations/claude-p/claude-pipe.ts` — runClaudePipe signature + options
  - `src/harness/context-builder.ts` — loadProjectContext signature
  - `src/core/validation-runner.ts` — runValidation signature + ValidationStep type
  - `src/core/error-classifier.ts` — classifyError + shouldEscalate signatures
  - `src/integrations/openclaw/client.ts` — sendAlert signature + AlertType
  - `src/integrations/github/client.ts` — createPullRequest, createBranch signatures
  - `src/api/sse.ts` — publishEvent signature
  - `src/storage/repositories/tasks-repo.ts` — updateTaskStatus, updateTaskTokens, setTaskCheckpointData
  - `src/storage/repositories/telemetry-repo.ts` — insertTelemetryEvent
  - `src/storage/repositories/work-items-repo.ts` — updateWorkItemStatus, rollupWorkItemTokens
  - `src/cli/commands/run.ts` — the current delegate flow (lines 383-510) as reference for event handling
  - `config/config.yaml` — validation steps, github config, session limits
  - `src/config.ts` — loadConfig return type

- [ ] Step 4: Rewrite `orchestration-loop.ts` with a single exported function:

```typescript
interface OrchestrationContext {
  taskId: string;
  workItemId: string;
  repo: string; // absolute path to the repo
  branch: string;
  description: string;
  complexity: "simple" | "medium" | "complex";
  provider: string; // 'opencode' | 'anthropic'
  attempt: number;
  maxAttempts: number;
  db: ReturnType<typeof getDb>;
  redis: Redis;
  config: AppConfig;
}

export async function orchestrateTask(ctx: OrchestrationContext): Promise<void>;
```

The function implements the 13 steps sequentially:

**Step 1 — Update status:**

- `updateTaskStatus(ctx.db, ctx.taskId, 'running')`
- `updateWorkItemStatus(ctx.db, ctx.workItemId, 'running')`
- `publishEvent(ctx.redis, { type: 'session_start', data: { taskId: ctx.taskId, model: ctx.provider } })`

**Step 2 — Provision workspace:**

- `const { worktreePath } = await createWorktree({ repoPath: ctx.repo, worktreesDir: ctx.config.engine.worktrees_dir, taskId: ctx.taskId, branch: ctx.branch })`
- Wrap in try/finally to ensure cleanup

**Step 3 — Load context:**

- `const projectContext = await loadProjectContext(worktreePath)`

**Step 4 — Run delegate:**

- Route based on ctx.provider:
  - 'opencode': `runOpencodePipe({ prompt: ctx.description, model: config.providers.opencode.default_model, workspacePath: worktreePath, opencodeBin: config.providers.opencode.binary })`
  - 'anthropic': `runClaudePipe({ prompt: ctx.description, workspacePath: worktreePath, claudeBin: config.providers.anthropic.binary })`
- For each event from the async generator:
  - `publishEvent(ctx.redis, { type: event.type, data: { taskId: ctx.taskId, ...event } })` (best-effort)
  - `insertTelemetryEvent(ctx.db, { taskId: ctx.taskId, eventType: event.type, payload: event })` (best-effort)
  - If token_update: `updateTaskTokens(ctx.db, ctx.taskId, event.used)` (best-effort)
  - If checkpoint: `setTaskCheckpointData(ctx.db, ctx.taskId, { messages: event })`, set status to 'checkpointing', return early
  - If session_end with reason != 'completed': throw with reason

**Step 5 — Validate:**

- Check if worktree has `package.json` or `tsconfig.json`
- If yes: `const validationResult = await runValidation({ workspacePath: worktreePath, steps: config.validation.typescript, execCommand })`
- Store: update task record with `validationResults`
- If `!validationResult.passed` and `ctx.attempt < ctx.maxAttempts`:
  - Build retry prompt with validation error output
  - Increment attempt, recurse `orchestrateTask({ ...ctx, attempt: ctx.attempt + 1, description: retryPrompt })`
  - Return (retry handles the rest)
- If `!validationResult.passed` and attempts exhausted: throw 'validation_failed'

**Step 6 — Create PR:**

- `execSync('git add -A && git commit -m "claw: ${title}"', { cwd: worktreePath })`
- `execSync('git push -u origin ${branch}', { cwd: worktreePath })`
- If `config.github.auto_create_pr`:
  - `const pr = await createPullRequest({ repo, branch, title, body })`
  - Update task: prUrl, prNumber

**Step 7 — Cleanup (in finally block):**

- `await removeWorktree({ repoPath: ctx.repo, worktreePath })`

**Step 8 — Update DB:**

- `updateTaskStatus(ctx.db, ctx.taskId, 'completed')`
- `rollupWorkItemTokens(ctx.db, ctx.workItemId)`
- Check if all tasks in work item are done → `updateWorkItemStatus(ctx.db, ctx.workItemId, 'completed')`

**Step 9 — Publish completion:**

- `publishEvent(ctx.redis, { type: 'session_end', data: { taskId: ctx.taskId, reason: 'completed' } })`

**Step 10 — Notify:**

- `sendAlert({ type: 'session_completed', message: '✅ Task completed: ${title}. PR: ${prUrl}', taskId: ctx.taskId, workItemId: ctx.workItemId })`

**Error handling (wraps the whole function):**

- Catch any error:
  - `const errorClass = classifyError(error.message)`
  - If retryable (timeout, rate_limit, network) and attempts remain: recurse with incremented attempt
  - If fatal (auth) or attempts exhausted:
    - `updateTaskStatus(ctx.db, ctx.taskId, 'failed')`
    - `publishEvent(ctx.redis, { type: 'session_end', data: { taskId: ctx.taskId, reason: 'error' } })`
    - `sendAlert({ type: 'session_failed', message: '❌ Task failed: ${errorClass}: ${error.message}', taskId: ctx.taskId })`
  - Always cleanup worktree in finally

- [ ] Step 5: Run `npx tsc --noEmit` — verify compiles
- [ ] Step 6: Commit: `feat: implement orchestration loop 13-step pipeline (#14)`

---

### Task 2: Wire BullMQ Workers in daemon.ts

**Files:**

- Modify: `src/daemon.ts`

**Steps:**

- [ ] Step 1: Read current `src/daemon.ts` to understand the startup flow
- [ ] Step 2: Read `src/core/scheduler.ts` to understand queue names and job data shape (TaskJobData)
- [ ] Step 3: After `createServer()` and before the health check loop, add BullMQ Workers:

```typescript
// Create workers for each provider queue
const QUEUE_NAMES = ["claw:alibaba", "claw:anthropic", "claw:default"];
const workers: Worker[] = [];

for (const queueName of QUEUE_NAMES) {
  const worker = new Worker(
    queueName,
    async (job: Job<TaskJobData>) => {
      const ctx: OrchestrationContext = {
        taskId: job.data.dagNodeId, // or look up task ID from dagNodeId
        workItemId: job.data.workItemId,
        repo: job.data.repo,
        branch: job.data.branch,
        description: job.data.description,
        complexity: job.data.complexity,
        provider: job.data.provider,
        attempt: 1,
        maxAttempts: 3,
        db: getDb({ connectionString: connStr }),
        redis,
        config,
      };
      await orchestrateTask(ctx);
    },
    {
      connection: { host: config.redis.host, port: config.redis.port },
      concurrency: queueName.includes("anthropic") ? 1 : 3,
    },
  );
  workers.push(worker);
}
```

- [ ] Step 4: Add graceful shutdown — on SIGTERM, close all workers before closing Fastify
- [ ] Step 5: Run `npx tsc --noEmit` — verify compiles
- [ ] Step 6: Commit: `feat: add BullMQ workers to daemon for orchestration loop`

---

### Task 3: Wire claw submit to decomposer + enqueueDAG

**Files:**

- Modify: `src/cli/commands/submit.ts`

**Steps:**

- [ ] Step 1: Read current `src/cli/commands/submit.ts` — it creates a work item but doesn't decompose or enqueue
- [ ] Step 2: Read `src/core/decomposer.ts` — how to decompose a description into a WorkItemDAG
- [ ] Step 3: Read `src/core/scheduler.ts` — how createScheduler + enqueueDAG work
- [ ] Step 4: After `createWorkItem()`, add:
  - Call `classifyTask()` to get complexity (reuse from run.ts)
  - Call `decompose()` or build a simple single-task DAG if decomposition is not needed
  - Call `createScheduler()` then `scheduler.enqueueDAG(dag)`
  - Update work item with the DAG in the `dag` field
  - For each task in the DAG, `createTask()` in DB
  - Print task IDs and queue info to stderr
- [ ] Step 5: Handle the simple case: if description is straightforward (no multi-step), create a single-node DAG directly without calling decomposer (avoid LLM call overhead)
- [ ] Step 6: Run `npx tsc --noEmit` — verify compiles
- [ ] Step 7: Commit: `feat: wire claw submit to decomposer and BullMQ scheduler`

---

### Task 4: Tests for orchestration loop

**Files:**

- Create: `tests/unit/core/orchestration-loop.test.ts`

**Steps:**

- [ ] Step 1: Write tests using mocked dependencies:

**Test 1: Happy path — task completes successfully**

- Mock: createWorktree, loadProjectContext, runOpencodePipe (yields tool_use + session_end), runValidation (passes), createPullRequest, removeWorktree, publishEvent, insertTelemetryEvent, updateTaskStatus, sendAlert
- Assert: task status → running → completed, worktree created and cleaned up, PR created, alert sent

**Test 2: Validation fails then retries successfully**

- Mock: runValidation fails on attempt 1, passes on attempt 2
- Assert: attempt incremented, delegate called twice, final status = completed

**Test 3: Validation fails all retries**

- Mock: runValidation fails on all attempts (maxAttempts=2)
- Assert: task status = failed, alert type = session_failed

**Test 4: Delegate error — retryable (timeout)**

- Mock: delegate throws timeout error
- Assert: classifyError called, retry attempted

**Test 5: Delegate error — fatal (auth)**

- Mock: delegate throws auth error
- Assert: no retry, task status = failed immediately

**Test 6: Worktree cleanup on error**

- Mock: delegate throws, removeWorktree is a spy
- Assert: removeWorktree called even on error (finally block)

**Test 7: SSE events published for each delegate event**

- Mock: delegate yields 3 events
- Assert: publishEvent called 3 times + session_start + session_end

- [ ] Step 2: Run `npm test` — verify all pass
- [ ] Step 3: Commit: `test: orchestration loop unit tests`

---

### Task 5: Build, integration test, code review

- [ ] Step 1: Run `npx tsc --noEmit` — zero errors
- [ ] Step 2: Run `npm test` — all pass including new tests
- [ ] Step 3: Manual integration test:
  - Ensure daemon is running (`launchctl list | grep claw`)
  - Run `claw submit "Add a comment to src/config.ts"`
  - Watch dashboard for live events
  - Verify task completes, PR created, Telegram notification received
- [ ] Step 4: Code review via nexus:requesting-code-review
- [ ] Step 5: Create PR via `gh pr create`
- [ ] Step 6: Commit: `feat: orchestration loop complete (#14)`

---

## Dependency Graph

```
Task 1 (orchestration-loop.ts) ─┐
Task 2 (daemon workers)         ├→ Task 4 (tests) → Task 5 (review + PR)
Task 3 (submit wiring)          ─┘
```

Tasks 1, 2, 3 are independent — can run in parallel via claw.
Task 4 depends on Task 1 (tests the function).
Task 5 is final verification.

## Execution Strategy

- **Batch 1:** Tasks 1, 2, 3 via claw (3 parallel runs)
- **Batch 2:** Task 4 via claw (tests)
- **Batch 3:** Task 5 (manual verification + code review + PR)
