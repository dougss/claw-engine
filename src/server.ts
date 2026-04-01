import Fastify from "fastify";
import cors from "@fastify/cors";
import { Redis } from "ioredis";
import { loadConfig } from "./config.js";
import { getDb } from "./storage/db.js";
import { registerWorkItemRoutes } from "./api/routes/work-items.js";
import { registerTaskRoutes } from "./api/routes/tasks.js";
import { registerMetricsRoutes } from "./api/routes/metrics.js";
import { registerLogsRoutes } from "./api/routes/logs.js";
import { registerSessionRoutes } from "./api/routes/sessions.js";
import { handleSseConnection } from "./api/sse.js";

export async function createServer(configPath?: string) {
  const config = loadConfig(configPath);
  const connectionString =
    process.env.CLAW_ENGINE_DATABASE_URL ??
    (() => {
      const dbPassword = process.env[config.database.password_env] ?? "";
      return `postgresql://${config.database.user}:${dbPassword}@${config.database.host}:${config.database.port}/${config.database.database}`;
    })();
  const db = getDb({ connectionString });

  const redis = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    lazyConnect: true,
  });

  const app = Fastify({ logger: false });

  await app.register(cors, { origin: true });

  // API routes
  app.register(
    async (api) => {
      registerWorkItemRoutes(api, db);
      registerTaskRoutes(api, db);
      registerMetricsRoutes(api, db);
      registerLogsRoutes(api, db);
      registerSessionRoutes(api, db);

      // SSE endpoint — each connection gets its own subscriber redis instance
      api.get("/events", async (request, reply) => {
        const lastEventId = (request.headers["last-event-id"] as string) ?? "";
        const subscriber = new Redis({
          host: config.redis.host,
          port: config.redis.port,
        });
        try {
          await handleSseConnection(redis, subscriber, reply, lastEventId);
        } finally {
          await subscriber.disconnect();
        }
      });
    },
    { prefix: "/api" },
  );

  return { app, config, redis, db };
}
