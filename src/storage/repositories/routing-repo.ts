import { eq } from "drizzle-orm";
import { routingHistory } from "../schema/index.js";
import type { getDb } from "../db.js";

type Db = ReturnType<typeof getDb>;

export interface InsertRoutingHistoryInput {
  taskId: string;
  taskPattern: string;
  repo: string;
  complexity: string;
  model: string;
  success: boolean;
  tokensUsed?: number;
  durationMs?: number;
  keywords?: string[];
  validationFirstPass?: boolean;
}

export async function insertRoutingHistory(
  db: Db,
  input: InsertRoutingHistoryInput,
) {
  const [result] = await db
    .insert(routingHistory)
    .values({
      taskId: input.taskId,
      taskPattern: input.taskPattern,
      repo: input.repo,
      complexity: input.complexity,
      model: input.model,
      success: input.success,
      tokensUsed: input.tokensUsed ?? null,
      durationMs: input.durationMs ?? null,
      keywords: input.keywords ?? null,
      validationFirstPass: input.validationFirstPass ?? null,
    })
    .returning();
  return result;
}

export async function getRoutingHistoryByTaskId(db: Db, taskId: string) {
  return db
    .select()
    .from(routingHistory)
    .where(eq(routingHistory.taskId, taskId));
}
