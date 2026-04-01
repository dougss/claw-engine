import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const workItems = pgTable(
  "work_items",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v4()`),
    title: varchar("title", { length: 512 }).notNull(),
    description: text("description"),
    source: varchar("source", { length: 64 }).notNull(),
    sourceRef: varchar("source_ref", { length: 512 }),
    status: varchar("status", { length: 32 }).notNull().default("queued"),
    priority: integer("priority").notNull().default(3),
    dag: jsonb("dag"),
    totalTokensUsed: bigint("total_tokens_used", { mode: "number" }).default(0),
    totalCostUsd: numeric("total_cost_usd", {
      precision: 10,
      scale: 4,
    }).default("0"),
    tasksTotal: integer("tasks_total").default(0),
    tasksCompleted: integer("tasks_completed").default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_work_items_status").on(table.status),
    index("idx_work_items_created").on(table.createdAt),
  ],
);
