import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { tasks } from "./tasks.drizzle";

export const routingHistory = pgTable(
  "routing_history",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v4()`),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    taskPattern: varchar("task_pattern", { length: 256 }).notNull(),
    repo: varchar("repo", { length: 256 }).notNull(),
    complexity: varchar("complexity", { length: 16 }).notNull(),
    keywords: text("keywords").array(),
    model: varchar("model", { length: 128 }).notNull(),
    success: boolean("success").notNull(),
    tokensUsed: bigint("tokens_used", { mode: "number" }),
    durationMs: bigint("duration_ms", { mode: "number" }),
    validationFirstPass: boolean("validation_first_pass"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_routing_pattern").on(table.taskPattern),
    index("idx_routing_model").on(table.model, table.success),
    index("idx_routing_created").on(table.createdAt),
  ],
);
