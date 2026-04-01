import { sql } from "drizzle-orm";
import {
  bigint,
  date,
  integer,
  numeric,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const costSnapshots = pgTable(
  "cost_snapshots",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v4()`),
    periodType: varchar("period_type", { length: 16 }).notNull(),
    periodStart: date("period_start").notNull(),
    claudeTokens: bigint("claude_tokens", { mode: "number" })
      .notNull()
      .default(0),
    alibabaTokens: bigint("alibaba_tokens", { mode: "number" })
      .notNull()
      .default(0),
    totalTokens: bigint("total_tokens", { mode: "number" })
      .notNull()
      .default(0),
    alibabaCostUsd: numeric("alibaba_cost_usd", { precision: 10, scale: 4 })
      .notNull()
      .default("0"),
    estimatedClaudeCostUsd: numeric("estimated_claude_cost_usd", {
      precision: 10,
      scale: 4,
    })
      .notNull()
      .default("0"),
    estimatedSavingsUsd: numeric("estimated_savings_usd", {
      precision: 10,
      scale: 4,
    })
      .notNull()
      .default("0"),
    sessionsTotal: integer("sessions_total").notNull().default(0),
    sessionsEngine: integer("sessions_engine").notNull().default(0),
    sessionsDelegate: integer("sessions_delegate").notNull().default(0),
    workItemsCompleted: integer("work_items_completed").notNull().default(0),
    escalations: integer("escalations").notNull().default(0),
    firstPassSuccessRate: numeric("first_pass_success_rate", {
      precision: 5,
      scale: 2,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique("uq_cost_period").on(table.periodType, table.periodStart)],
);
