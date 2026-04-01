import type { FastifyInstance } from "fastify";
import { inArray } from "drizzle-orm";
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
  app.get("/sessions", async () => {
    const activeTasks = await db
      .select()
      .from(tasks)
      .where(inArray(tasks.status, ACTIVE_STATUSES));
    return { sessions: activeTasks };
  });
}
