import type { FastifyInstance } from "fastify";
import { getTaskById } from "../../storage/repositories/tasks-repo.js";
import { getTelemetryByTaskId } from "../../storage/repositories/telemetry-repo.js";
import type { getDb } from "../../storage/db.js";

type Db = ReturnType<typeof getDb>;

export function registerTaskRoutes(app: FastifyInstance, db: Db): void {
  app.get("/tasks/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const task = await getTaskById(db, id);
    if (!task) {
      reply.status(404);
      return { error: "task not found" };
    }
    const telemetry = await getTelemetryByTaskId(db, id);
    return { ...task, telemetry };
  });
}
