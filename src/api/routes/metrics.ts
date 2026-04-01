import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import type { getDb } from "../../storage/db.js";
import { tasks, workItems } from "../../storage/schema/index.js";

type Db = ReturnType<typeof getDb>;

export function registerMetricsRoutes(app: FastifyInstance, db: Db): void {
  app.get("/metrics", async () => {
    const [taskStats] = await db
      .select({
        total: sql<number>`count(*)::int`,
        completed: sql<number>`count(*) filter (where ${tasks.status} = 'completed')::int`,
        failed: sql<number>`count(*) filter (where ${tasks.status} = 'failed')::int`,
        running: sql<number>`count(*) filter (where ${tasks.status} = 'running')::int`,
        pending: sql<number>`count(*) filter (where ${tasks.status} = 'pending')::int`,
        totalTokens: sql<number>`coalesce(sum(${tasks.tokensUsed}), 0)::bigint`,
        totalCost: sql<number>`coalesce(sum(${tasks.costUsd}::numeric), 0)`,
      })
      .from(tasks);

    const [workItemStats] = await db
      .select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`count(*) filter (where ${workItems.status} not in ('completed','failed','cancelled'))::int`,
      })
      .from(workItems);

    return {
      tasks: taskStats ?? {
        total: 0,
        completed: 0,
        failed: 0,
        running: 0,
        pending: 0,
        totalTokens: 0,
        totalCost: 0,
      },
      workItems: workItemStats ?? { total: 0, active: 0 },
    };
  });
}
