import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { Redis } from "ioredis";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { getDb } from "./storage/db.js";
import { registerWorkItemRoutes } from "./api/routes/work-items.js";
import { registerTaskRoutes } from "./api/routes/tasks.js";
import { registerMetricsRoutes } from "./api/routes/metrics.js";
import { registerLogsRoutes } from "./api/routes/logs.js";
import { registerSessionRoutes } from "./api/routes/sessions.js";
import { registerStatsRoutes } from "./api/routes/stats.js";
import { handleSseConnection } from "./api/sse.js";

export async function createServer(configPath?: string) {
  const config = loadConfig(configPath);
  const connectionString =
    process.env.CLAW_ENGINE_DATABASE_URL ??
    (() => {
      const dbPassword =
        process.env[config.database.password_env] ?? "claw_engine_local";
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
      registerStatsRoutes(api, db);

      // Health check endpoint
      api.get("/health", async (_request, reply) => {
        return reply.send({ 
          status: 'ok', 
          uptime: process.uptime() 
        });
      });

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

  // Serve React dashboard static files in production
  // import.meta.url → dist/server.js → dirname = dist/ → join "dashboard" = dist/dashboard/
  const dashboardDir = join(
    dirname(fileURLToPath(import.meta.url)),
    "dashboard",
  );
  if (existsSync(dashboardDir)) {
    await app.register(fastifyStatic, {
      root: dashboardDir,
      prefix: "/",
      // SPA fallback: serve index.html for unknown routes (except /api)
      wildcard: false,
    });
    app.setNotFoundHandler(async (_req, reply) => {
      if (!_req.url.startsWith("/api")) {
        return reply.sendFile("index.html");
      }
      reply.status(404).send({ error: "not found" });
    });
  }

  return { app, config, redis, db };
}
