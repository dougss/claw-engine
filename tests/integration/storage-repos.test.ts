import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb, closeDb } from "../../src/storage/db.js";
import {
  createWorkItem,
  getWorkItemById,
  listWorkItems,
  updateWorkItemStatus,
} from "../../src/storage/repositories/work-items-repo.js";
import {
  createTask,
  getTaskById,
  getTasksByWorkItemId,
  updateTaskStatus,
} from "../../src/storage/repositories/tasks-repo.js";
import {
  insertTelemetryEvent,
  getTelemetryByTaskId,
} from "../../src/storage/repositories/telemetry-repo.js";
import {
  insertRoutingHistory,
  getRoutingHistoryByTaskId,
} from "../../src/storage/repositories/routing-repo.js";

const CONNECTION =
  process.env.CLAW_ENGINE_DATABASE_URL ??
  "postgres://claw_engine:claw_engine_local@127.0.0.1:5432/claw_engine";

describe("storage repositories (integration)", () => {
  let db: ReturnType<typeof getDb>;

  beforeAll(() => {
    db = getDb({ connectionString: CONNECTION });
  });

  afterAll(async () => {
    await closeDb();
  });

  it("creates and retrieves a work item", async () => {
    const wi = await createWorkItem(db, {
      title: "Test feature",
      description: "Integration test",
      repos: ["dougss/test"],
    });

    expect(wi.id).toBeTruthy();
    expect(wi.status).toBe("queued");

    const retrieved = await getWorkItemById(db, wi.id);
    expect(retrieved?.title).toBe("Test feature");
  });

  it("updates work item status", async () => {
    const wi = await createWorkItem(db, {
      title: "Status test",
      description: "Test",
      repos: [],
    });

    await updateWorkItemStatus(db, wi.id, "running");
    const updated = await getWorkItemById(db, wi.id);
    expect(updated?.status).toBe("running");
  });

  it("lists work items with status filter", async () => {
    const wi = await createWorkItem(db, {
      title: "List test",
      description: "Test",
      repos: [],
    });
    await updateWorkItemStatus(db, wi.id, "completed");

    const completed = await listWorkItems(db, { status: "completed" });
    expect(completed.some((w) => w.id === wi.id)).toBe(true);
  });

  it("creates a task linked to a work item", async () => {
    const wi = await createWorkItem(db, {
      title: "Task test",
      description: "test",
      repos: ["dougss/finno"],
    });

    const task = await createTask(db, {
      workItemId: wi.id,
      repo: "dougss/finno",
      branch: "feat/test-task",
      description: "Add endpoint",
      complexity: "simple",
      estimatedTokens: 5000,
    });

    expect(task.id).toBeTruthy();
    expect(task.workItemId).toBe(wi.id);
    expect(task.status).toBe("pending");
  });

  it("retrieves tasks by work item id", async () => {
    const wi = await createWorkItem(db, {
      title: "Multi-task",
      description: "t",
      repos: [],
    });
    await createTask(db, {
      workItemId: wi.id,
      repo: "r",
      branch: "b1",
      description: "t1",
      complexity: "simple",
      estimatedTokens: 1000,
    });
    await createTask(db, {
      workItemId: wi.id,
      repo: "r",
      branch: "b2",
      description: "t2",
      complexity: "medium",
      estimatedTokens: 5000,
    });

    const tasks = await getTasksByWorkItemId(db, wi.id);
    expect(tasks).toHaveLength(2);
  });

  it("inserts and retrieves telemetry events", async () => {
    const wi = await createWorkItem(db, {
      title: "Telemetry",
      description: "t",
      repos: [],
    });
    const task = await createTask(db, {
      workItemId: wi.id,
      repo: "r",
      branch: "b",
      description: "t",
      complexity: "simple",
      estimatedTokens: 100,
    });

    await insertTelemetryEvent(db, {
      taskId: task.id,
      eventType: "text_delta",
      payload: { text: "hello" },
    });

    const events = await getTelemetryByTaskId(db, task.id);
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].eventType).toBe("text_delta");
  });

  it("inserts routing history entry", async () => {
    const wi = await createWorkItem(db, {
      title: "Routing",
      description: "t",
      repos: [],
    });
    const task = await createTask(db, {
      workItemId: wi.id,
      repo: "r",
      branch: "b",
      description: "t",
      complexity: "simple",
      estimatedTokens: 100,
    });

    await insertRoutingHistory(db, {
      taskId: task.id,
      taskPattern: "add endpoint",
      repo: "dougss/finno",
      complexity: "simple",
      model: "qwen3.5-plus",
      success: true,
      tokensUsed: 5000,
    });

    const history = await getRoutingHistoryByTaskId(db, task.id);
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history[0].model).toBe("qwen3.5-plus");
    expect(history[0].success).toBe(true);
  });
});
