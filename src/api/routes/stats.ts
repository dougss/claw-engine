import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import type { getDb } from "../../storage/db.js";
import { tasks, workItems } from "../../storage/schema/index.js";

type Db = ReturnType<typeof getDb>;

export function registerStatsRoutes(app: FastifyInstance, db: Db): void {
  app.get("/stats", async () => {
    // Get total work items
    const [workItemStats] = await db
      .select({
        total: sql<number>`count(*)::int`,
      })
      .from(workItems);

    // Get task statistics including totals and model breakdown
    const [taskStats, modelBreakdown] = await Promise.all([
      db
        .select({
          total: sql<number>`count(*)::int`,
          totalTokens: sql<number>`coalesce(sum(${tasks.tokensUsed}), 0)::bigint`,
          totalCost: sql<number>`coalesce(sum(${tasks.costUsd}::numeric), 0)`,
        })
        .from(tasks),
      db
        .select({
          model: tasks.model,
          count: sql<number>`count(*)::int`,
        })
        .from(tasks)
        .groupBy(tasks.model)
        .orderBy(tasks.model),
    ]);

    return {
      totalWorkItems: workItemStats?.total ?? 0,
      totalTasks: taskStats[0]?.total ?? 0,
      totalTokensUsed: parseInt(String(taskStats[0]?.totalTokens ?? 0), 10),
      totalCostUsd: parseFloat(String(taskStats[0]?.totalCost ?? "0")),
      tasksByModel: modelBreakdown.map((row) => ({
        model: row.model || "unknown",
        count: row.count,
      })),
    };
  });
}
