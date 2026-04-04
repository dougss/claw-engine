// orchestration-loop.ts — 13-step pipeline for autonomous task execution.
// Rewrites stubs with real implementations calling existing components.

import { execFile as execFileCb } from "node:child_process";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { eq } from "drizzle-orm";
import type { Redis } from "ioredis";
import type { ClawEngineConfig } from "../config-schema.js";
import type { getDb } from "../storage/db.js";
import { tasks } from "../storage/schema/index.js";
import {
  createWorktree,
  removeWorktree,
} from "../integrations/git/worktrees.js";
import { runOpencodePipe } from "../integrations/opencode/opencode-pipe.js";
import { runClaudePipe } from "../integrations/claude-p/claude-pipe.js";
import { loadProjectContext } from "../harness/context-builder.js";
import { runValidation } from "./validation-runner.js";
import { classifyError } from "./error-classifier.js";
import { sendAlert } from "../integrations/openclaw/client.js";
import { createPullRequest } from "../integrations/github/client.js";
import { publishEvent } from "../api/sse.js";
import {
  updateTaskStatus,
  updateTaskTokens,
  setTaskCheckpointData,
  getTasksByWorkItemId,
} from "../storage/repositories/tasks-repo.js";
import { insertTelemetryEvent } from "../storage/repositories/telemetry-repo.js";
import {
  updateWorkItemStatus,
  rollupWorkItemTokens,
} from "../storage/repositories/work-items-repo.js";

// Error classes that must not trigger a retry
const FATAL_ERROR_CLASSES = new Set(["auth"]);

export interface OrchestrationContext {
  taskId: string;
  workItemId: string;
  /** Absolute path to the git repository */
  repo: string;
  branch: string;
  description: string;
  complexity: "simple" | "medium" | "complex";
  /** 'opencode' | 'anthropic' */
  provider: string;
  attempt: number;
  maxAttempts: number;
  db: ReturnType<typeof getDb>;
  redis: Redis;
  config: ClawEngineConfig;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs the delegate pipe (opencode or claude -p), publishing every event to
 * Redis SSE and persisting to telemetry. Returns true if the task was
 * checkpointed (caller must return early), false on normal completion.
 */
async function runDelegate(
  ctx: OrchestrationContext,
  prompt: string,
  worktreePath: string,
): Promise<boolean> {
  const gen =
    ctx.provider === "opencode"
      ? runOpencodePipe({
          prompt,
          model: ctx.config.providers.opencode.default_model,
          opencodeBin: ctx.config.providers.opencode.binary,
          workspacePath: worktreePath,
          timeoutMs: ctx.config.sessions.stall_timeout_delegate_ms,
        })
      : runClaudePipe({
          prompt,
          claudeBin: ctx.config.providers.anthropic.binary,
          workspacePath: worktreePath,
          timeoutMs: ctx.config.sessions.stall_timeout_delegate_ms,
        });

  for await (const event of gen) {
    // Publish to Redis SSE (best-effort — dashboard sees live events)
    void publishEvent(ctx.redis, {
      type: event.type,
      data: { taskId: ctx.taskId, ...event },
    }).catch(() => {});

    // Persist telemetry (best-effort)
    void insertTelemetryEvent(ctx.db, {
      taskId: ctx.taskId,
      eventType: event.type,
      payload: event as unknown as Record<string, unknown>,
    }).catch(() => {});

    if (event.type === "token_update") {
      void updateTaskTokens(ctx.db, ctx.taskId, event.used).catch(() => {});
    } else if (event.type === "checkpoint") {
      await setTaskCheckpointData(ctx.db, ctx.taskId, {
        reason: event.reason,
      }).catch(() => {});
      await updateTaskStatus(ctx.db, ctx.taskId, "checkpointing").catch(
        () => {},
      );
      return true; // task saved for later resume
    } else if (event.type === "session_end" && event.reason !== "completed") {
      throw new Error(`session ended with reason: ${event.reason}`);
    }
  }

  return false; // completed normally
}

export async function orchestrateTask(
  ctx: OrchestrationContext,
): Promise<void> {
  // Tracks worktree for cleanup in finally — null until Step 2 succeeds
  let worktreePath: string | null = null;

  const worktreesDir = ctx.config.engine.worktrees_dir.replace(/^~/, homedir());

  try {
    // ── Step 1: Update status to running ─────────────────────────────────────
    await updateTaskStatus(ctx.db, ctx.taskId, "running").catch(() => {});
    await updateWorkItemStatus(ctx.db, ctx.workItemId, "running").catch(
      () => {},
    );
    await ctx.db
      .update(tasks)
      .set({ startedAt: new Date() })
      .where(eq(tasks.id, ctx.taskId))
      .catch(() => {});

    void publishEvent(ctx.redis, {
      type: "session_start",
      data: { taskId: ctx.taskId, model: ctx.provider },
    }).catch(() => {});

    // ── Step 2: Provision workspace ───────────────────────────────────────────
    const wt = await createWorktree({
      repoPath: ctx.repo,
      worktreesDir,
      taskId: ctx.taskId,
      branch: ctx.branch,
    });
    worktreePath = wt.worktreePath;
    // Local const so closures below see a non-nullable string
    const wtp = wt.worktreePath;

    // ── Step 3: Load context ──────────────────────────────────────────────────
    // Verifies workspace is accessible; delegate reads CLAUDE.md on its own
    await loadProjectContext(wtp).catch(() => "");

    // ── Step 4: Run delegate (with error-based retry) ─────────────────────────
    let delegateAttempt = ctx.attempt;

    while (true) {
      try {
        const checkpointed = await runDelegate(ctx, ctx.description, wtp);
        if (checkpointed) return; // task handed off for later resume
        break; // delegate completed normally
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const errorClass = classifyError(errorMsg);

        await ctx.db
          .update(tasks)
          .set({ lastError: errorMsg, errorClass })
          .where(eq(tasks.id, ctx.taskId))
          .catch(() => {});

        if (
          FATAL_ERROR_CLASSES.has(errorClass) ||
          delegateAttempt >= ctx.maxAttempts
        ) {
          throw err instanceof Error ? err : new Error(errorMsg);
        }

        delegateAttempt++;
        await ctx.db
          .update(tasks)
          .set({ attempt: delegateAttempt })
          .where(eq(tasks.id, ctx.taskId))
          .catch(() => {});
        // continue → retry delegate
      }
    }

    // ── Step 5: Validate (if project has TS/JS tooling) ──────────────────────
    const hasValidation =
      (await pathExists(join(wtp, "package.json"))) ||
      (await pathExists(join(wtp, "tsconfig.json")));

    if (hasValidation) {
      const execCommand = async (
        command: string,
        cwd: string,
      ): Promise<{ stdout: string; exitCode: number }> => {
        const [cmd, ...args] = command.split(/\s+/);
        return new Promise((resolve) => {
          execFileCb(
            cmd!,
            args,
            { cwd, encoding: "utf8" },
            (err, stdout, stderr) => {
              if (!err) {
                resolve({ stdout, exitCode: 0 });
                return;
              }
              const exitCode = typeof err.code === "number" ? err.code : 1;
              resolve({ stdout: stdout + stderr, exitCode });
            },
          );
        });
      };

      const maxValidationRetries = ctx.config.validation.max_retries;
      let validationAttempt = 0;
      let validationPassed = false;

      while (true) {
        const result = await runValidation({
          workspacePath: wtp,
          steps: ctx.config.validation.typescript,
          execCommand,
        });

        await ctx.db
          .update(tasks)
          .set({
            validationResults: result as unknown as Record<string, unknown>,
            validationAttempts: validationAttempt + 1,
          })
          .where(eq(tasks.id, ctx.taskId))
          .catch(() => {});

        void publishEvent(ctx.redis, {
          type: "validation_result",
          data: { taskId: ctx.taskId, ...result },
        }).catch(() => {});

        if (result.passed) {
          validationPassed = true;
          break;
        }

        if (validationAttempt >= maxValidationRetries) {
          break; // exhausted retries — validationPassed stays false
        }

        // Re-run delegate with validation error context
        validationAttempt++;
        const failedOutput = result.steps
          .filter((s) => !s.passed)
          .map((s) => `[${s.name}]\n${s.output}`)
          .join("\n\n");

        const retryPrompt = `${ctx.description}\n\nFix the following validation errors:\n\n${failedOutput}`;
        await runDelegate(ctx, retryPrompt, wtp);
      }

      if (!validationPassed) {
        throw new Error("validation_failed: all retries exhausted");
      }
    }

    // ── Step 6: Commit, push, create PR ──────────────────────────────────────
    // Try to commit any remaining changes (delegate may have already committed)
    try {
      await new Promise<void>((resolve, reject) => {
        execFileCb("git", ["-C", wtp, "add", "-A"], (err) =>
          err ? reject(err) : resolve(),
        );
      });
      const title = ctx.description.slice(0, 72).replace(/"/g, "'");
      await new Promise<void>((resolve, reject) => {
        execFileCb(
          "git",
          ["-C", wtp, "commit", "-m", `claw: ${title}`],
          (err) => (err ? reject(err) : resolve()),
        );
      });
    } catch {
      // Nothing to commit or delegate already committed — fine
    }

    try {
      await new Promise<void>((resolve, reject) => {
        execFileCb(
          "git",
          ["-C", wtp, "push", "-u", "origin", ctx.branch],
          (err) => (err ? reject(err) : resolve()),
        );
      });
    } catch {
      // Push may have already been done by delegate — ignore
    }

    let prUrl: string | undefined;
    let prNumber: number | undefined;

    if (ctx.config.github.auto_create_pr) {
      try {
        const repoName = `${ctx.config.github.default_org}/${basename(ctx.repo)}`;
        const pr = await createPullRequest({
          repo: repoName,
          branch: ctx.branch,
          title: `claw: ${ctx.description.slice(0, 70)}`,
          body: `Automated by claw-engine.\n\nTask ID: \`${ctx.taskId}\`\nWork item: \`${ctx.workItemId}\``,
        });
        prUrl = pr.url;
        prNumber = pr.number;

        await ctx.db
          .update(tasks)
          .set({ prUrl, prNumber })
          .where(eq(tasks.id, ctx.taskId))
          .catch(() => {});
      } catch (prErr) {
        console.warn(
          "[orchestration] PR creation failed:",
          prErr instanceof Error ? prErr.message : prErr,
        );
      }
    }

    // ── Step 8: Update DB — completed status + work item rollup ──────────────
    await updateTaskStatus(ctx.db, ctx.taskId, "completed").catch(() => {});
    await ctx.db
      .update(tasks)
      .set({ completedAt: new Date() })
      .where(eq(tasks.id, ctx.taskId))
      .catch(() => {});
    await rollupWorkItemTokens(ctx.db, ctx.workItemId).catch(() => {});

    const allTasksOnSuccess = await getTasksByWorkItemId(
      ctx.db,
      ctx.workItemId,
    ).catch(() => []);
    const allTerminalOnSuccess = allTasksOnSuccess.every(
      (t) => t.status === "completed" || t.status === "failed",
    );
    if (allTerminalOnSuccess && allTasksOnSuccess.length > 0) {
      await updateWorkItemStatus(ctx.db, ctx.workItemId, "completed").catch(
        () => {},
      );
    }

    // ── Step 9: Publish completion SSE ────────────────────────────────────────
    void publishEvent(ctx.redis, {
      type: "session_end",
      data: { taskId: ctx.taskId, reason: "completed" },
    }).catch(() => {});

    // ── Step 10: Notify via Telegram (fire-and-forget — must not block cleanup) ─
    void Promise.resolve(
      sendAlert({
        type: "session_completed",
        message: `✅ Task completed: ${ctx.description.slice(0, 60)}${prUrl ? ` | PR: ${prUrl}` : ""}`,
        taskId: ctx.taskId,
        workItemId: ctx.workItemId,
      }),
    ).catch(() => {});
  } catch (err) {
    // ── Error path: classify, update DB, notify ───────────────────────────────
    const errorMsg = err instanceof Error ? err.message : String(err);
    const errorClass = classifyError(errorMsg);

    await updateTaskStatus(ctx.db, ctx.taskId, "failed").catch(() => {});
    await ctx.db
      .update(tasks)
      .set({ lastError: errorMsg, errorClass, completedAt: new Date() })
      .where(eq(tasks.id, ctx.taskId))
      .catch(() => {});
    await rollupWorkItemTokens(ctx.db, ctx.workItemId).catch(() => {});

    const allTasksOnFail = await getTasksByWorkItemId(
      ctx.db,
      ctx.workItemId,
    ).catch(() => []);
    const allTerminalOnFail = allTasksOnFail.every(
      (t) => t.status === "completed" || t.status === "failed",
    );
    if (allTerminalOnFail && allTasksOnFail.length > 0) {
      const anyCompleted = allTasksOnFail.some((t) => t.status === "completed");
      await updateWorkItemStatus(
        ctx.db,
        ctx.workItemId,
        anyCompleted ? "completed" : "failed",
      ).catch(() => {});
    }

    void publishEvent(ctx.redis, {
      type: "session_end",
      data: { taskId: ctx.taskId, reason: "error" },
    }).catch(() => {});

    void Promise.resolve(
      sendAlert({
        type: "session_failed",
        message: `❌ Task failed [${errorClass}]: ${errorMsg.slice(0, 120)}`,
        taskId: ctx.taskId,
        workItemId: ctx.workItemId,
      }),
    ).catch(() => {});
  } finally {
    // ── Step 7 / Cleanup: always remove worktree ──────────────────────────────
    // Use the known path even if createWorktree threw before setting worktreePath
    const cleanupPath = worktreePath ?? join(worktreesDir, ctx.taskId);
    await removeWorktree({
      repoPath: ctx.repo,
      worktreePath: cleanupPath,
    }).catch(() => {});
  }
}
