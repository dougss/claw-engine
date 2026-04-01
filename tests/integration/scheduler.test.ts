import { describe, it, expect, afterEach } from "vitest";
import { Queue, Worker } from "bullmq";
import {
  createScheduler,
  type SchedulerContext,
  type TaskJobData,
} from "../../src/core/scheduler.js";
import type { WorkItemDAG } from "../../src/core/dag-schema.js";

const REDIS_CONN = { host: "127.0.0.1", port: 6379 };

/** Clean up all test queues by name after each test */
const queueNames: string[] = [];
afterEach(async () => {
  // Create fresh Queue instances just for cleanup (original ones may be closed)
  await Promise.all(
    queueNames.map(async (name) => {
      const q = new Queue(name, { connection: REDIS_CONN });
      try {
        await q.obliterate({ force: true });
      } finally {
        await q.close();
      }
    }),
  );
  queueNames.length = 0;
});

describe("Scheduler — DAG ordering", () => {
  it("enqueues task-1 immediately, task-2 after task-1 completes, task-3 after task-2", async () => {
    const dag: WorkItemDAG = {
      title: "linear DAG",
      tasks: [
        {
          id: "t1",
          repo: "repo1",
          branch: "claw/t1",
          description: "task 1",
          complexity: "simple",
          estimated_tokens: 100,
          context_filter: [],
          nexus_skills: [],
          mcp_servers: [],
        },
        {
          id: "t2",
          repo: "repo1",
          branch: "claw/t2",
          description: "task 2",
          complexity: "simple",
          estimated_tokens: 100,
          context_filter: [],
          nexus_skills: [],
          mcp_servers: [],
        },
        {
          id: "t3",
          repo: "repo1",
          branch: "claw/t3",
          description: "task 3",
          complexity: "simple",
          estimated_tokens: 100,
          context_filter: [],
          nexus_skills: [],
          mcp_servers: [],
        },
      ],
      edges: [
        { from: "t1", to: "t2", type: "blocks" },
        { from: "t2", to: "t3", type: "blocks" },
      ],
    };

    const executionOrder: string[] = [];
    const ctx: SchedulerContext = {
      redis: REDIS_CONN,
      workItemId: "wi-test-linear",
      queueSuffix: "sched-test-linear",
      onTaskComplete: async (taskId) => {
        executionOrder.push(`done:${taskId}`);
      },
      onTaskFailed: async (_taskId, _err) => {},
      runTask: async (job: TaskJobData) => {
        executionOrder.push(job.dagNodeId);
        // Simulate task work
        await new Promise((r) => setTimeout(r, 10));
      },
    };

    const scheduler = await createScheduler(ctx);
    queueNames.push(...scheduler.queues.map((q) => q.name));

    await scheduler.enqueueDAG(dag);

    // Wait for all 3 tasks to run (linear chain takes ~3 * 10ms + overhead)
    await new Promise((r) => setTimeout(r, 2000));
    await scheduler.close();

    // All 3 tasks must have run
    expect(executionOrder.filter((e) => !e.startsWith("done:"))).toEqual([
      "t1",
      "t2",
      "t3",
    ]);

    // t1 must complete before t2 starts, t2 before t3
    const t1Idx = executionOrder.indexOf("t1");
    const t1DoneIdx = executionOrder.indexOf("done:t1");
    const t2Idx = executionOrder.indexOf("t2");
    const t2DoneIdx = executionOrder.indexOf("done:t2");
    const t3Idx = executionOrder.indexOf("t3");

    expect(t1Idx).toBeLessThan(t1DoneIdx);
    expect(t1DoneIdx).toBeLessThan(t2Idx);
    expect(t2DoneIdx).toBeLessThan(t3Idx);
  });

  it("enqueues independent tasks in parallel", async () => {
    const dag: WorkItemDAG = {
      title: "parallel DAG",
      tasks: [
        {
          id: "p1",
          repo: "r",
          branch: "claw/p1",
          description: "p1",
          complexity: "simple",
          estimated_tokens: 50,
          context_filter: [],
          nexus_skills: [],
          mcp_servers: [],
        },
        {
          id: "p2",
          repo: "r",
          branch: "claw/p2",
          description: "p2",
          complexity: "simple",
          estimated_tokens: 50,
          context_filter: [],
          nexus_skills: [],
          mcp_servers: [],
        },
      ],
      edges: [],
    };

    const startTimes: Record<string, number> = {};
    const ctx: SchedulerContext = {
      redis: REDIS_CONN,
      workItemId: "wi-test-parallel",
      queueSuffix: "sched-test-parallel",
      onTaskComplete: async () => {},
      onTaskFailed: async () => {},
      runTask: async (job) => {
        startTimes[job.dagNodeId] = Date.now();
        await new Promise((r) => setTimeout(r, 20));
      },
    };

    const scheduler = await createScheduler(ctx);
    queueNames.push(...scheduler.queues.map((q) => q.name));

    await scheduler.enqueueDAG(dag);
    await new Promise((r) => setTimeout(r, 2000));
    await scheduler.close();

    expect(startTimes["p1"]).toBeDefined();
    expect(startTimes["p2"]).toBeDefined();
    // Both should start within 200ms of each other (parallel)
    expect(Math.abs(startTimes["p1"]! - startTimes["p2"]!)).toBeLessThan(200);
  });

  it("calls onTaskFailed when runTask throws", async () => {
    const dag: WorkItemDAG = {
      title: "fail DAG",
      tasks: [
        {
          id: "f1",
          repo: "r",
          branch: "claw/f1",
          description: "will fail",
          complexity: "simple",
          estimated_tokens: 50,
          context_filter: [],
          nexus_skills: [],
          mcp_servers: [],
        },
      ],
      edges: [],
    };

    let caughtErr: Error | null = null;
    const ctx: SchedulerContext = {
      redis: REDIS_CONN,
      workItemId: "wi-test-fail",
      queueSuffix: "sched-test-fail",
      onTaskComplete: async () => {},
      onTaskFailed: async (_id, err) => {
        caughtErr = err;
      },
      runTask: async () => {
        throw new Error("simulated task failure");
      },
    };

    const scheduler = await createScheduler(ctx);
    queueNames.push(...scheduler.queues.map((q) => q.name));

    await scheduler.enqueueDAG(dag);
    await new Promise((r) => setTimeout(r, 2000));
    await scheduler.close();

    expect(caughtErr).toBeDefined();
    expect((caughtErr as Error).message).toContain("simulated task failure");
  });
});
