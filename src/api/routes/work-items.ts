import type { FastifyInstance } from "fastify";
import { desc } from "drizzle-orm";
import {
  listWorkItems,
  getWorkItemById,
} from "../../storage/repositories/work-items-repo.js";
import { getTasksByWorkItemId } from "../../storage/repositories/tasks-repo.js";
import { workItems } from "../../storage/schema/index.js";
import type { getDb } from "../../storage/db.js";

type Db = ReturnType<typeof getDb>;

export function registerWorkItemRoutes(app: FastifyInstance, db: Db): void {
  app.get("/work-items", async (request) => {
    const query = request.query as {
      status?: string;
      limit?: string;
      with_tasks?: string;
    };
    const limit = Math.min(parseInt(query.limit ?? "50", 10), 200);
    const items = await db
      .select()
      .from(workItems)
      .orderBy(desc(workItems.createdAt))
      .limit(limit);

    if (query.with_tasks === "1") {
      const withTasks = await Promise.all(
        items.map(async (wi) => ({
          ...wi,
          tasks: await getTasksByWorkItemId(db, wi.id),
        })),
      );
      return { items: withTasks, total: withTasks.length };
    }

    return { items, total: items.length };
  });

  app.get("/work-items/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const item = await getWorkItemById(db, id);
    if (!item) {
      reply.status(404);
      return { error: "work item not found" };
    }
    const tasks = await getTasksByWorkItemId(db, id);
    return { ...item, tasks };
  });
}
