import type { FastifyInstance } from "fastify";
import {
  listWorkItems,
  getWorkItemById,
} from "../../storage/repositories/work-items-repo.js";
import { getTasksByWorkItemId } from "../../storage/repositories/tasks-repo.js";
import type { getDb } from "../../storage/db.js";

type Db = ReturnType<typeof getDb>;

export function registerWorkItemRoutes(app: FastifyInstance, db: Db): void {
  app.get("/work-items", async (request) => {
    const query = request.query as {
      status?: string;
      page?: string;
      limit?: string;
    };
    const status = query.status;
    const items = await listWorkItems(db, status ? { status } : undefined);
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
