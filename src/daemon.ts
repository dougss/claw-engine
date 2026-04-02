import { loadDefaultEnvFiles } from "./env-loader.js";
loadDefaultEnvFiles();
import { createServer } from "./server.js";
import { reconcileOnStartup } from "./core/reconcile.js";
import { closeDb } from "./storage/db.js";
import {
  checkSessionHealth,
  type SessionHealth,
} from "./core/health-monitor.js";
import { homedir } from "node:os";
import { join } from "node:path";

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

  // Periodic health check — sessions register themselves here as they start
  const activeSessions = new Map<string, SessionHealth>();
  const healthCheckInterval = setInterval(() => {
    for (const [, session] of activeSessions) {
      const result = checkSessionHealth(session);
      if (result.action === "kill") {
        console.warn(
          `[health-monitor] stalled session detected: ${result.sessionId} — ${result.reason}`,
        );
      }
    }
  }, 30_000);
  healthCheckInterval.unref();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`[claw-engine] received ${signal}, shutting down...`);
    clearInterval(healthCheckInterval);
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
