import { eq } from "drizzle-orm";
import { tasks } from "../schema/index.js";
import type { getDb } from "../db.js";

type Db = ReturnType<typeof getDb>;

export interface CreateTaskInput {
  workItemId: string;
  repo: string;
  branch: string;
  description: string;
  complexity: string;
  estimatedTokens?: number;
  dagNodeId?: string;
  model?: string;
}

export async function createTask(db: Db, input: CreateTaskInput) {
  const [result] = await db
    .insert(tasks)
    .values({
      workItemId: input.workItemId,
      repo: input.repo,
      branch: input.branch,
      description: input.description,
      complexity: input.complexity,
      dagNodeId: input.dagNodeId ?? "node-0",
      model: input.model ?? null,
      status: "pending",
    })
    .returning();
  return result;
}

export async function getTaskById(db: Db, id: string) {
  const [result] = await db.select().from(tasks).where(eq(tasks.id, id));
  return result ?? null;
}

export async function getTasksByWorkItemId(db: Db, workItemId: string) {
  return db.select().from(tasks).where(eq(tasks.workItemId, workItemId));
}

export async function updateTaskStatus(db: Db, id: string, status: string) {
  const [result] = await db
    .update(tasks)
    .set({ status })
    .where(eq(tasks.id, id))
    .returning();
  return result;
}
