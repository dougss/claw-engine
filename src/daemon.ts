import { loadDefaultEnvFiles } from "./env-loader.js";
loadDefaultEnvFiles();
import { createServer } from "./server.js";
import { reconcileOnStartup } from "./core/reconcile.js";
import { closeDb } from "./storage/db.js";
import { checkSessionHealth } from "./core/health-monitor.js";
import { activeSessionRegistry } from "./core/session-registry.js";
import { homedir } from "node:os";
import { join } from "node:path";
import { Worker, type Job } from "bullmq";
import { orchestrateTask, type OrchestrationContext } from "./core/orchestration-loop.js";
import { getDb } from "./storage/db.js";
import { TaskJobData } from "./core/scheduler.js";

async function main(): Promise<void> {
  const configPath = process.env.CLAW_ENGINE_CONFIG;
  const { app, config, redis } = await createServer(configPath);

  const worktreesDir = config.engine.worktrees_dir.replace("~", homedir());

  // Startup reconciliation
  const { orphansRemoved, tasksRequeued } = await reconcileOnStartup({
    // db is created inside createServer but we need it here
    // Pass the getDb singleton pattern
    db: (await import("./storage/db.js")).getDb({
      connectionString:
        process.env.CLAW_ENGINE_DATABASE_URL ??
        (() => {
          const pw =
            process.env[config.database.password_env] ?? "claw_engine_local";
          return `postgresql://${config.database.user}:${pw}@${config.database.host}:${config.database.port}/${config.database.database}`;
        })(),
    }),
    worktreesDir,
  });

  if (orphansRemoved > 0 || tasksRequeued > 0) {
    console.log(
      `[reconcile] orphans removed: ${orphansRemoved}, tasks re-queued: ${tasksRequeued}`,
    );
  }

  // Start Fastify
  await app.listen({ host: config.engine.host, port: config.engine.port });
  console.log(
    `[claw-engine] listening on ${config.engine.host}:${config.engine.port}`,
  );

  // Create workers for each provider queue
  const QUEUE_NAMES = ["claw:alibaba", "claw:anthropic", "claw:default"];
  const workers: Worker[] = [];

  // Connection string for DB
  const connStr = process.env.CLAW_ENGINE_DATABASE_URL ??
    (() => {
      const pw = process.env[config.database.password_env] ?? "claw_engine_local";
      return `postgresql://${config.database.user}:${pw}@${config.database.host}:${config.database.port}/${config.database.database}`;
    })();

  for (const queueName of QUEUE_NAMES) {
    const worker = new Worker<TaskJobData>(
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

  // Periodic health check — sessions register themselves via session-registry
  const healthCheckInterval = setInterval(() => {
    for (const [sessionId, entry] of activeSessionRegistry) {
      const result = checkSessionHealth(entry.health);
      if (result.action === "kill") {
        console.warn(
          `[health-monitor] killing stalled session ${result.sessionId} — ${result.reason}`,
        );
        entry.abort();
        activeSessionRegistry.delete(sessionId);
        // TODO: if the session was started from a BullMQ job, mark that job as failed here
      }
    }
  }, 30_000);
  healthCheckInterval.unref();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`[claw-engine] received ${signal}, shutting down...`);
    clearInterval(healthCheckInterval);
    
    // Close all workers gracefully before shutting down
    await Promise.all(workers.map(worker => worker.close()));
    
    await app.close();
    await redis.quit();
    await closeDb();
    process.exit(0);
  };

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
}

main().catch((err) => {
  console.error("[claw-engine] fatal:", err);
  process.exit(1);
});
