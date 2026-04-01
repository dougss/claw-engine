import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import type { getDb } from "../../storage/db.js";
import { sessionTelemetry } from "../../storage/schema/index.js";

type Db = ReturnType<typeof getDb>;

export function registerLogsRoutes(app: FastifyInstance, db: Db): void {
  app.get("/logs", async (request) => {
    const query = request.query as {
      task_id?: string;
      level?: string;
      limit?: string;
    };

    let q = db.select().from(sessionTelemetry).$dynamic();
    if (query.task_id) {
      q = q.where(eq(sessionTelemetry.taskId, query.task_id));
    }

    const limit = Math.min(parseInt(query.limit ?? "100", 10), 500);
    const entries = await q.limit(limit);
    return { entries, total: entries.length };
  });
}
