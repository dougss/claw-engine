import type { FastifyInstance } from "fastify";
import { count, desc, inArray } from "drizzle-orm";
import type { getDb } from "../../storage/db.js";
import { tasks } from "../../storage/schema/index.js";

type Db = ReturnType<typeof getDb>;

const ACTIVE_STATUSES = [
  "running",
  "starting",
  "provisioning",
  "checkpointing",
  "validating",
];

export function registerSessionRoutes(app: FastifyInstance, db: Db): void {
  // Active sessions (currently running tasks)
  app.get("/sessions", async () => {
    const activeTasks = await db
      .select()
      .from(tasks)
      .where(inArray(tasks.status, ACTIVE_STATUSES))
      .orderBy(desc(tasks.createdAt));
    return { sessions: activeTasks };
  });

  // All tasks, ordered by most recent (with offset pagination)
  app.get("/tasks", async (request) => {
    const query = request.query as { limit?: string; offset?: string };
    const limit = Math.min(parseInt(query.limit ?? "50", 10), 200);
    const offset = Math.max(parseInt(query.offset ?? "0", 10), 0);

    const [allTasks, [totalRow]] = await Promise.all([
      db
        .select()
        .from(tasks)
        .orderBy(desc(tasks.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ count: count() }).from(tasks),
    ]);

    return { tasks: allTasks, total: totalRow?.count ?? 0, limit, offset };
  });
}
