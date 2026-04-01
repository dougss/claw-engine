import { and, gte, lte } from "drizzle-orm";
import { costSnapshots } from "../schema/index.js";
import type { getDb } from "../db.js";

type Db = ReturnType<typeof getDb>;

export interface InsertCostSnapshotInput {
  periodType: string;
  periodStart: string;
  claudeTokens?: number;
  alibabaTokens?: number;
  totalTokens?: number;
  alibabaCostUsd?: string;
  estimatedClaudeCostUsd?: string;
  estimatedSavingsUsd?: string;
  sessionsTotal?: number;
  sessionsEngine?: number;
  sessionsDelegate?: number;
  workItemsCompleted?: number;
  escalations?: number;
  firstPassSuccessRate?: string;
}

export async function insertCostSnapshot(
  db: Db,
  input: InsertCostSnapshotInput,
) {
  const [result] = await db
    .insert(costSnapshots)
    .values({
      periodType: input.periodType,
      periodStart: input.periodStart,
      claudeTokens: input.claudeTokens ?? 0,
      alibabaTokens: input.alibabaTokens ?? 0,
      totalTokens: input.totalTokens ?? 0,
      alibabaCostUsd: input.alibabaCostUsd ?? "0",
      estimatedClaudeCostUsd: input.estimatedClaudeCostUsd ?? "0",
      estimatedSavingsUsd: input.estimatedSavingsUsd ?? "0",
      sessionsTotal: input.sessionsTotal ?? 0,
      sessionsEngine: input.sessionsEngine ?? 0,
      sessionsDelegate: input.sessionsDelegate ?? 0,
      workItemsCompleted: input.workItemsCompleted ?? 0,
      escalations: input.escalations ?? 0,
      firstPassSuccessRate: input.firstPassSuccessRate ?? null,
    })
    .returning();
  return result;
}

export async function getCostSnapshotsByDateRange(
  db: Db,
  start: string,
  end: string,
) {
  return db
    .select()
    .from(costSnapshots)
    .where(
      and(
        gte(costSnapshots.periodStart, start),
        lte(costSnapshots.periodStart, end),
      ),
    );
}
