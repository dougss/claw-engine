import { Queue, Worker, type ConnectionOptions } from "bullmq";
import type { WorkItemDAG } from "./dag-schema.js";

export interface TaskJobData {
  dagNodeId: string;
  repo: string;
  branch: string;
  description: string;
  complexity: "simple" | "medium" | "complex";
  estimatedTokens: number;
  workItemId: string;
  /** dag node IDs that this task depends on */
  dependsOn: string[];
  /** provider queue this job was placed on */
  provider: string;
}

export interface SchedulerContext {
  redis: ConnectionOptions;
  workItemId: string;
  /** Unique suffix to namespace queues for this work item (avoids cross-test pollution) */
  queueSuffix?: string;
  /** Provider → max requests per minute; defaults to unlimited */
  rateLimits?: Record<string, { max: number; duration: number }>;
  onTaskComplete: (taskId: string) => Promise<void>;
  onTaskFailed: (taskId: string, err: Error) => Promise<void>;
  runTask: (job: TaskJobData) => Promise<void>;
}

export interface Scheduler {
  enqueueDAG: (dag: WorkItemDAG) => Promise<void>;
  /** Signal a task complete externally (used in tests / when runTask is external) */
  notifyComplete: (dagNodeId: string) => Promise<void>;
  close: () => Promise<void>;
  queues: Queue[];
}

export async function createScheduler(
  ctx: SchedulerContext,
): Promise<Scheduler> {
  const {
    redis,
    workItemId,
    queueSuffix = workItemId,
    rateLimits = {},
    onTaskComplete,
    onTaskFailed,
    runTask,
  } = ctx;

  // One queue per provider; default providers we expect
  const providerNames = ["alibaba", "anthropic", "default"];
  const queues = new Map<string, Queue<TaskJobData>>();
  const workers = new Map<string, Worker<TaskJobData>>();

  for (const provider of providerNames) {
    const queueName = `claw-${provider}-${queueSuffix}`;
    const limiter = rateLimits[provider];
    const queue = new Queue<TaskJobData>(queueName, {
      connection: redis,
      ...(limiter
        ? {
            limiter: {
              max: limiter.max,
              duration: limiter.duration,
              groupKey: "provider",
            },
          }
        : {}),
    });
    queues.set(provider, queue);
  }

  // Track completion per dag node id to unblock dependents
  const completed = new Set<string>();
  // Map dagNodeId → job data (populated on enqueueDAG)
  const allJobs = new Map<string, TaskJobData>();
  // For each dagNodeId, which dagNodeIds depend on it
  const dependents = new Map<string, string[]>();

  async function tryEnqueue(nodeId: string): Promise<void> {
    const job = allJobs.get(nodeId);
    if (!job) return;
    // Check all deps satisfied
    if (job.dependsOn.every((dep) => completed.has(dep))) {
      const queue = queues.get(job.provider) ?? queues.get("default")!;
      await queue.add(nodeId, job, { jobId: `${queueSuffix}-${nodeId}` });
    }
  }

  async function handleCompletion(dagNodeId: string): Promise<void> {
    completed.add(dagNodeId);
    await onTaskComplete(dagNodeId);
    // Unblock dependents
    const deps = dependents.get(dagNodeId) ?? [];
    for (const depId of deps) {
      await tryEnqueue(depId);
    }
  }

  // Start workers for each queue
  for (const [provider, queue] of queues) {
    const worker = new Worker<TaskJobData>(
      queue.name,
      async (job) => {
        await runTask(job.data);
        await handleCompletion(job.data.dagNodeId);
      },
      {
        connection: redis,
        concurrency: provider === "anthropic" ? 1 : 3,
      },
    );

    worker.on("failed", async (job, err) => {
      if (job) {
        await onTaskFailed(job.data.dagNodeId, err);
      }
    });

    workers.set(provider, worker);
  }

  return {
    queues: [...queues.values()],

    async enqueueDAG(dag: WorkItemDAG): Promise<void> {
      // Build dependency index and job map
      for (const task of dag.tasks) {
        const dependsOn = dag.edges
          .filter((e) => e.to === task.id && e.type === "blocks")
          .map((e) => e.from);

        // Build reverse index
        for (const dep of dependsOn) {
          if (!dependents.has(dep)) dependents.set(dep, []);
          dependents.get(dep)!.push(task.id);
        }

        // Simple provider assignment: complex → anthropic, else alibaba
        const provider =
          task.complexity === "complex" ? "anthropic" : "alibaba";

        const jobData: TaskJobData = {
          dagNodeId: task.id,
          repo: task.repo,
          branch: task.branch,
          description: task.description,
          complexity: task.complexity,
          estimatedTokens: task.estimated_tokens,
          workItemId,
          dependsOn,
          provider,
        };

        allJobs.set(task.id, jobData);
      }

      // Enqueue all tasks with no dependencies immediately
      for (const [nodeId, job] of allJobs) {
        if (job.dependsOn.length === 0) {
          const queue = queues.get(job.provider) ?? queues.get("default")!;
          await queue.add(nodeId, job, { jobId: `${queueSuffix}-${nodeId}` });
        }
      }
    },

    async notifyComplete(dagNodeId: string): Promise<void> {
      await handleCompletion(dagNodeId);
    },

    async close(): Promise<void> {
      await Promise.all([...workers.values()].map((w) => w.close()));
      await Promise.all([...queues.values()].map((q) => q.close()));
    },
  };
}
