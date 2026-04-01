import { eq } from "drizzle-orm";
import { sessionTelemetry } from "../schema/index.js";
import type { getDb } from "../db.js";
import { randomUUID } from "crypto";

type Db = ReturnType<typeof getDb>;

export interface InsertTelemetryInput {
  taskId: string;
  eventType: string;
  payload: Record<string, unknown>;
  correlationId?: string;
}

export async function insertTelemetryEvent(
  db: Db,
  input: InsertTelemetryInput,
) {
  const [result] = await db
    .insert(sessionTelemetry)
    .values({
      taskId: input.taskId,
      eventType: input.eventType,
      data: input.payload,
      correlationId: input.correlationId ?? randomUUID(),
    })
    .returning();
  return result;
}

export async function getTelemetryByTaskId(db: Db, taskId: string) {
  return db
    .select()
    .from(sessionTelemetry)
    .where(eq(sessionTelemetry.taskId, taskId));
}
