import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { eq, inArray } from "drizzle-orm";
import type { getDb } from "../storage/db.js";
import { tasks } from "../storage/schema/index.js";

type Db = ReturnType<typeof getDb>;

export interface ReconcileContext {
  db: Db;
  worktreesDir: string;
  scheduler?: {
    requeue: (taskId: string) => Promise<void>;
  };
}

export interface ReconcileResult {
  orphansRemoved: number;
  tasksRequeued: number;
}

/** Lists worktree directories from disk. Each dir name is expected to be the task ID. */
async function listWorktreesOnDisk(worktreesDir: string): Promise<string[]> {
  try {
    const entries = await readdir(worktreesDir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    // Directory doesn't exist yet
    return [];
  }
}

async function getActiveTaskIds(db: Db): Promise<Set<string>> {
  const activeTasks = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      inArray(tasks.status, [
        "pending",
        "provisioning",
        "starting",
        "running",
        "checkpointing",
        "validating",
        "needs_human_review",
        "interrupted",
        "resuming",
        "merging_dependency",
        "stalled",
        "blocked",
      ]),
    );
  return new Set(activeTasks.map((t) => t.id));
}

async function getRunningTasks(db: Db) {
  return db
    .select()
    .from(tasks)
    .where(inArray(tasks.status, ["running", "starting", "provisioning"]));
}

/**
 * On daemon startup:
 * 1. Remove orphan worktrees (dirs with no matching active task)
 * 2. Re-queue tasks that were "running" when daemon last died
 */
export async function reconcileOnStartup({
  db,
  worktreesDir,
  scheduler,
}: ReconcileContext): Promise<ReconcileResult> {
  const [diskWorktrees, activeTaskIds] = await Promise.all([
    listWorktreesOnDisk(worktreesDir),
    getActiveTaskIds(db),
  ]);

  // Remove orphan worktrees
  let orphansRemoved = 0;
  for (const dirName of diskWorktrees) {
    if (!activeTaskIds.has(dirName)) {
      try {
        await rm(join(worktreesDir, dirName), { recursive: true, force: true });
        orphansRemoved++;
      } catch {
        // Best-effort cleanup
      }
    }
  }

  // Re-queue interrupted running tasks
  const runningTasks = await getRunningTasks(db);
  let tasksRequeued = 0;

  for (const task of runningTasks) {
    // Mark as interrupted
    await db
      .update(tasks)
      .set({ status: "interrupted" })
      .where(eq(tasks.id, task.id));

    if (scheduler) {
      await scheduler.requeue(task.id);
    }

    tasksRequeued++;
  }

  return { orphansRemoved, tasksRequeued };
}
