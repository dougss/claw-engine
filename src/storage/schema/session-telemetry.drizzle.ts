import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { tasks } from "./tasks.drizzle";

export const sessionTelemetry = pgTable(
  "session_telemetry",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v4()`),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    correlationId: uuid("correlation_id").notNull(),
    eventType: varchar("event_type", { length: 64 }).notNull(),
    data: jsonb("data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_telemetry_task").on(table.taskId),
    index("idx_telemetry_correlation").on(table.correlationId),
    index("idx_telemetry_type").on(table.eventType),
    index("idx_telemetry_created").on(table.createdAt),
  ],
);
