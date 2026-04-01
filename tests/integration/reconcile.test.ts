import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDb, closeDb } from "../../src/storage/db.js";
import { createWorkItem } from "../../src/storage/repositories/work-items-repo.js";
import { createTask } from "../../src/storage/repositories/tasks-repo.js";
import { tasks } from "../../src/storage/schema/index.js";
import { eq } from "drizzle-orm";
import { reconcileOnStartup } from "../../src/core/reconcile.js";

const CONNECTION =
  process.env.CLAW_ENGINE_DATABASE_URL ??
  "postgres://claw_engine:claw_engine_local@127.0.0.1:5432/claw_engine";

let db: ReturnType<typeof getDb>;
let worktreesDir: string;
let createdTaskIds: string[] = [];

beforeEach(async () => {
  db = getDb({ connectionString: CONNECTION });
  worktreesDir = join(tmpdir(), `claw-reconcile-test-${Date.now()}`);
  await mkdir(worktreesDir, { recursive: true });
  createdTaskIds = [];
});

afterEach(async () => {
  // Clean up test tasks
  for (const id of createdTaskIds) {
    await db.delete(tasks).where(eq(tasks.id, id));
  }
  await rm(worktreesDir, { recursive: true, force: true });
  await closeDb();
});

describe("reconcileOnStartup", () => {
  it("removes orphan worktree dirs with no matching active task", async () => {
    // Create orphan directory (no task record)
    const orphanId = "00000000-dead-beef-0000-000000000001";
    const orphanDir = join(worktreesDir, orphanId);
    await mkdir(orphanDir, { recursive: true });

    const result = await reconcileOnStartup({ db, worktreesDir });

    expect(result.orphansRemoved).toBe(1);

    // Dir should be removed
    await expect(stat(orphanDir)).rejects.toThrow();
  });

  it("keeps worktree dir for active task", async () => {
    // Create a work item + running task
    const wi = await createWorkItem(db, {
      title: "reconcile test",
      repos: ["test/repo"],
    });
    const task = await createTask(db, {
      workItemId: wi.id,
      repo: "test/repo",
      branch: "claw/test",
      description: "running task",
      complexity: "simple",
    });
    createdTaskIds.push(task.id);

    // Set to running
    await db
      .update(tasks)
      .set({ status: "running" })
      .where(eq(tasks.id, task.id));

    // Create matching worktree dir
    const taskDir = join(worktreesDir, task.id);
    await mkdir(taskDir, { recursive: true });

    await reconcileOnStartup({ db, worktreesDir });

    // Dir should still exist (task is active)
    const dirStat = await stat(taskDir);
    expect(dirStat.isDirectory()).toBe(true);
  });

  it("marks running tasks as interrupted and re-queues them", async () => {
    const wi = await createWorkItem(db, {
      title: "interrupt test",
      repos: ["test/repo"],
    });
    const task = await createTask(db, {
      workItemId: wi.id,
      repo: "test/repo",
      branch: "claw/test",
      description: "was running",
      complexity: "simple",
    });
    createdTaskIds.push(task.id);

    // Mark as running
    await db
      .update(tasks)
      .set({ status: "running" })
      .where(eq(tasks.id, task.id));

    const requeuedIds: string[] = [];
    const result = await reconcileOnStartup({
      db,
      worktreesDir,
      scheduler: {
        requeue: async (id) => {
          requeuedIds.push(id);
        },
      },
    });

    expect(result.tasksRequeued).toBe(1);
    expect(requeuedIds).toContain(task.id);

    // Task should now be "interrupted"
    const [updated] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, task.id));
    expect(updated?.status).toBe("interrupted");
  });
});
