import { eq } from "drizzle-orm";
import { workItems } from "../schema/index.js";
import type { getDb } from "../db.js";

type Db = ReturnType<typeof getDb>;

export interface CreateWorkItemInput {
  title: string;
  description?: string;
  repos: string[];
  source?: string;
  priority?: number;
}

export async function createWorkItem(db: Db, input: CreateWorkItemInput) {
  const [result] = await db
    .insert(workItems)
    .values({
      title: input.title,
      description: input.description ?? null,
      source: input.source ?? "api",
      dag: { repos: input.repos },
      status: "queued",
      priority: input.priority ?? 3,
    })
    .returning();
  return result;
}

export async function getWorkItemById(db: Db, id: string) {
  const [result] = await db
    .select()
    .from(workItems)
    .where(eq(workItems.id, id));
  return result ?? null;
}

export async function listWorkItems(db: Db, filters?: { status?: string }) {
  if (filters?.status) {
    return db
      .select()
      .from(workItems)
      .where(eq(workItems.status, filters.status));
  }
  return db.select().from(workItems);
}

export async function updateWorkItemStatus(db: Db, id: string, status: string) {
  const [result] = await db
    .update(workItems)
    .set({ status, updatedAt: new Date() })
    .where(eq(workItems.id, id))
    .returning();
  return result;
}
