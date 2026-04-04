# E2E Test Report — Claw Engine

**Date:** 2026-04-03
**Tester:** Claude Opus 4.6 (automated QA)

## Environment

| Component           | Status                     | Details                                                        |
| ------------------- | -------------------------- | -------------------------------------------------------------- |
| Node.js             | v22.22.0                   | Homebrew node@22                                               |
| PostgreSQL          | OK                         | pgvector/pgvector:pg16, DB `claw_engine` accepting connections |
| Redis               | OK                         | redis:7-alpine, PONG response                                  |
| Fastify (port 3004) | OK                         | `{"status":"ok","uptime":7286}`                                |
| Daemon              | Running                    | PID active, tsx src/daemon.ts                                  |
| Dashboard           | OK                         | HTML served via Vite, SSE streaming functional                 |
| Unit Tests          | **303 passing** (43 files) | Duration: 1.59s                                                |

## Results Summary

| #   | Test                            | Result      | Duration | Notes                                                                                              |
| --- | ------------------------------- | ----------- | -------- | -------------------------------------------------------------------------------------------------- |
| 2.1 | `claw run` — simple task        | **PASS**    | ~15s     | Branch created, committed, PR #53 created                                                          |
| 2.2 | `claw run --no-commit`          | **PARTIAL** | ~20s     | No commit/PR (correct), but branch still created (bug)                                             |
| 2.3 | `claw run --delegate`           | **PASS**    | ~10s     | Routed to claude -p, branch + PR #54 created                                                       |
| 2.4 | `--dry-run` classification      | **FAIL**    | <1s      | dry-run exits before calling classifyTask                                                          |
| 3.1 | `claw submit` — simple          | **PASS**    | <15s     | Work item created, enqueued, completed, PR #55. Worktree cleaned.                                  |
| 3.2 | `claw submit` — with validation | **PASS**    | <30s     | Completed with 0 retries. Validation: typecheck (1.6s) + lint (81ms) + test 303/303 (2.3s). PR #56 |
| 4.1 | Dashboard — HTML/API            | **PASS**    | —        | HTML serves, `/api/v1/tasks` returns full task data                                                |
| 4.2 | Dashboard — SSE events          | **PASS**    | —        | `/api/v1/events` emits `session_end` in real-time                                                  |
| 4.3 | Dashboard — task detail         | **PASS**    | —        | `/api/v1/tasks/:id` returns full validation results, tokens, status                                |
| 4.4 | Dashboard — screenshots         | **SKIP**    | —        | Playwright not installed as Node package in project                                                |
| 5.1 | Redis offline during submit     | **FAIL**    | hung     | Work item created in DB, then infinite ECONNREFUSED stack traces                                   |
| 5.2 | Daemon restart during execution | **PARTIAL** | ~45s     | Reconcile detected orphan (re-queued: 1), but re-execution failed on worktree conflict             |
| 5.3 | Worktree cleanup                | **FAIL**    | —        | Residual worktree from failed reconcile task not cleaned up                                        |

**Overall: 7 PASS, 2 PARTIAL, 3 FAIL, 1 SKIP**

## Detailed Results

### Test 2.1: `claw run` — Simple Task

```bash
source ~/.openclaw/secrets/.env
npm run claw -- run . "Add a comment '// tested by e2e' at the top of src/types.ts"
```

**Output:**

- `classify → simple`
- `routing → opencode (simple/medium task → opencode)`
- Branch `claw/add-a-comment-tested-by-e2e-at-the-top-o-mnjpznht` created from main
- opencode executed: read src/types.ts, then edit to add comment
- Tokens: 16,904 / 200,000 (8%)
- Committed and pushed successfully
- **PR #53 created**: https://github.com/dougss/claw-engine/pull/53

**Note:** `failed to store: -25308` appears during git push (macOS Keychain issue, cosmetic only).

**Result: PASS**

---

### Test 2.2: `claw run --no-commit`

```bash
npm run claw -- run . "List all files in src/core/ and describe each one" --no-commit
```

**Output:**

- `classify → simple`
- `routing → opencode`
- **Branch created**: `claw/list-all-files-in-src-core-and-describe--mnjq1pdu` (unexpected)
- opencode read all 16 files in src/core/, listed descriptions
- Tokens: 71,884 / 200,000 (36%)
- `[git] nothing to commit` — correct, no changes committed
- No PR created — correct

**Issue:** `--no-commit` still creates a git branch. The flag should prevent branch creation entirely when no commit/PR is intended. The branch was created before execution and left behind even though nothing was committed.

**Result: PARTIAL (branch creation is a bug)**

---

### Test 2.3: `claw run --delegate`

```bash
npm run claw -- run . "Read src/core/orchestration-loop.ts and write a comprehensive JSDoc comment for the orchestrateTask function" --delegate
```

**Output:**

- `classify → medium`
- `routing → anthropic (forced claude -p)` — correctly forced by `--delegate`
- Branch `claw/read-src-core-orchestration-loop-ts-and--mnjq55cu` created
- claude -p executed: Read file, then Edit to add 40-line JSDoc
- Tokens: 928 / 200,000 (0%) — very efficient
- Committed and pushed
- **PR #54 created**: https://github.com/dougss/claw-engine/pull/54

**Result: PASS**

---

### Test 2.4: `--dry-run` Classification

```bash
npm run claw -- run . "Fix a typo" --dry-run
# Output: [dry-run] Would run in /path: "Fix a typo"

npm run claw -- run . "Implement a complete authentication system with JWT..." --dry-run
# Output: [dry-run] Would run in /path: "Implement a complete..."
```

**Issue:** `--dry-run` returns at line 192 of `src/cli/commands/run.ts` BEFORE calling `classifyTask()` at line 198. It only prints the repo path and prompt — no classification, no routing decision shown.

**Expected behavior:** dry-run should at minimum call `classifyTask()` and show the complexity + routing decision so the user can preview what would happen.

**Verification from real runs:**

- "Add a comment" → `classify → simple` (correct)
- "Read and write JSDoc" → `classify → medium` (correct)

The classifier itself works correctly; the dry-run just doesn't invoke it.

**Result: FAIL**

---

### Test 3.1: `claw submit` — Simple Task

```bash
docker exec redis redis-cli flushdb  # clean queue
npm run claw -- submit "Add a comment '// orchestration test' at top of src/server.ts" --repos ~/server/apps/claw-engine
```

**Output:**

- Work item `39c5dea4` created, status: queued
- Complexity: simple, Queue: claw-opencode
- Branch: `claw/add-a-comment-orchestration-test-at-top--mnjq96yv`
- Task `3fc5ad0f` enqueued

**After 15s polling:**

- Status: completed
- Model: dashscope/qwen3-coder-plus
- **PR #55 created**: https://github.com/dougss/claw-engine/pull/55
- Worktree directory empty after completion (properly cleaned up)

**Result: PASS**

---

### Test 3.2: `claw submit` — With Validation

```bash
npm run claw -- submit "In src/core/error-classifier.ts, add a new error category 'memory' that matches 'out of memory|heap|allocation failed'. Include a test in the existing test file." --repos ~/server/apps/claw-engine
```

**Output:**

- Work item `cdc466d1` created, complexity: medium
- Task `50a5c3bd` enqueued to claw-opencode
- Completed in <30s with 0 retries

**Validation results (from API):**
| Step | Passed | Duration |
|------|--------|----------|
| typecheck | true | 1,681ms |
| lint | true | 81ms |
| test (303/303) | true | 2,388ms |

- All 303 tests passed in the isolated worktree
- **PR #56 created**: https://github.com/dougss/claw-engine/pull/56
- Validation attempt: 1 (no retries needed)

**Result: PASS**

---

### Test 4: Dashboard

**4.1 — HTML/API:**

- `GET /` returns valid HTML with Vite-powered React SPA
- `GET /api/v1/tasks` returns JSON array with full task data (status, model, PR URL, tokens, validation results)

**4.2 — SSE Events:**

- `GET /api/v1/events` streams real-time events via Server-Sent Events
- Captured `session_end` event with taskId and reason during live task execution

**4.3 — Task Detail API:**

- `GET /api/v1/tasks/:id` returns comprehensive task record including:
  - Full validation results (per-step output, duration, pass/fail)
  - Token usage, attempt count, model, branch, PR URL
  - Checkpoint data, error classification fields

**4.4 — Visual Screenshots:**

- SKIPPED: Playwright is installed globally (`v1.59.1`) but not as a Node package in the project, so the screenshot script couldn't import it.

**Result: PASS (API verified, screenshots skipped)**

---

### Test 5.1: Redis Offline During Submit

```bash
docker stop redis
npm run claw -- submit "test task" --repos ~/server/apps/claw-engine
docker start redis
```

**Output:**

1. Work item `0e7b6c0a` created successfully in Postgres (status: queued)
2. Immediately after, infinite ECONNREFUSED errors to 127.0.0.1:6379
3. Error stack trace printed 11+ times with no backoff
4. Process never terminates — hangs indefinitely retrying Redis connection

**Issues:**

1. **No graceful degradation:** Should detect Redis is down before attempting enqueue, print a clear error, and exit with non-zero code
2. **Orphaned work item:** DB record left in `queued` status with no corresponding BullMQ job — will never be processed
3. **No retry backoff:** Stack traces repeat immediately without exponential backoff
4. **Process hangs:** Never exits, requiring manual kill (Ctrl+C)

**Result: FAIL**

---

### Test 5.2: Daemon Restart During Execution

```bash
# 1. Submit task
npm run claw -- submit "Read every file in src/integrations/ and list all exported functions" --repos ~/server/apps/claw-engine

# 2. Confirm running, then kill
pkill -f "tsx src/daemon"

# 3. Restart after 5s
nohup npx tsx src/daemon.ts > ~/server/logs/claw-engine.log 2>&1 &
```

**Timeline:**

- Task `ebf71a48` submitted → status: queued → running
- Daemon killed while task running
- Task marked as `interrupted` (correct detection)
- Daemon restarted: reconcile log shows `orphans removed: 0, tasks re-queued: 1`
- Task re-enqueued but **failed during re-execution**

**Failure reason:** Worktree creation failed because the branch `claw/read-every-file-in-src-integrations-and--mnjqg4rb` already existed from the interrupted run. The reconcile logic re-queued the task but didn't clean up the worktree/branch from the previous attempt.

**Daemon log:**

```
[reconcile] orphans removed: 0, tasks re-queued: 1
[openclaw] Failed to send alert: git worktree add failed
```

**Final status:** `failed` (after reconcile re-queue)

**Issues:**

1. Reconcile re-queues correctly but doesn't clean up the old worktree before re-executing
2. The re-execution fails with a git worktree conflict
3. Should either: clean worktree before re-queue, or reuse existing worktree

**Result: PARTIAL (reconcile detects + re-queues, but re-execution fails)**

---

### Test 5.3: Worktree Cleanup

```bash
ls ~/server/.worktrees/
# ebf71a48-dfbc-421b-9049-3c4ed0d4d48e  ← residual!

git -C ~/server/apps/claw-engine worktree list
# /Users/macmini/server/.worktrees/ebf71a48...  c64e7cf [claw/read-every-file-...]
```

**Issue:** The worktree from the failed reconcile task (test 5.2) was NOT cleaned up. The `finally` block in the orchestration loop should always remove worktrees, but the failure occurred during worktree creation itself, so the cleanup path likely doesn't handle pre-existing worktrees.

After manual cleanup with `git worktree remove --force`, directory was empty.

**Result: FAIL**

---

## Issues Found

### Critical

| #   | Issue                                                  | Impact                                                                                       | Location                                                      |
| --- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1   | **Redis offline → infinite hang + orphaned work item** | Submit creates DB record then hangs forever. Work item stuck in `queued` with no BullMQ job. | `src/cli/commands/submit.ts`                                  |
| 2   | **Reconcile doesn't clean worktrees before re-queue**  | Interrupted tasks fail on re-execution due to git worktree/branch conflicts.                 | `src/core/reconcile.ts` + `src/integrations/git/worktrees.ts` |

### Moderate

| #   | Issue                                       | Impact                                                                                | Location                                         |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 3   | **`--no-commit` still creates branch**      | Unnecessary branch creation when user only wants to execute without git side-effects. | `src/cli/commands/run.ts`                        |
| 4   | **`--dry-run` skips classification**        | Users can't preview complexity/routing decisions before executing.                    | `src/cli/commands/run.ts:191-193`                |
| 5   | **Residual worktree from failed reconcile** | Disk space leak, potential git conflicts on subsequent runs.                          | `src/core/orchestration-loop.ts` (finally block) |

### Cosmetic

| #   | Issue                                     | Impact                                                | Location              |
| --- | ----------------------------------------- | ----------------------------------------------------- | --------------------- |
| 6   | `failed to store: -25308` during git push | macOS Keychain warning, doesn't affect functionality. | git credential helper |

## Recommendations

1. **Redis health check before enqueue**: In `submit.ts`, ping Redis before creating the work item. If Redis is down, fail fast with a clear message and don't create the DB record.

2. **Worktree cleanup in reconcile**: Before re-queuing an interrupted task, check if a worktree/branch exists from the previous run and remove it. The `reconcile.ts` should call `removeWorktree()` or `git worktree remove --force` for any worktree matching the task ID.

3. **`--no-commit` should skip branch creation**: Move the branch creation logic after the `--no-commit` check, or gate it with `if (!opts.noCommit)`.

4. **`--dry-run` should show classification**: Move the dry-run check after `classifyTask()` to show the user: complexity, routing decision, and target provider. This is the primary value of dry-run.

5. **Add BullMQ connection retry with backoff and max attempts**: Instead of infinite retries with raw stack traces, use exponential backoff and a max attempt count (e.g., 5 retries over 30s), then fail cleanly.

6. **Integration test for resilience**: Add automated tests for Redis-down and daemon-restart scenarios. These are the most impactful failure modes.
