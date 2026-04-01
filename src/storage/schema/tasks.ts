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
import { workItems } from "./work-items.js";

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v4()`),
    workItemId: uuid("work_item_id")
      .notNull()
      .references(() => workItems.id, { onDelete: "cascade" }),
    dagNodeId: varchar("dag_node_id", { length: 64 }).notNull(),
    repo: varchar("repo", { length: 256 }).notNull(),
    branch: varchar("branch", { length: 256 }).notNull(),
    worktreePath: varchar("worktree_path", { length: 512 }),
    description: text("description").notNull(),
    complexity: varchar("complexity", { length: 16 })
      .notNull()
      .default("medium"),
    contextFilter: text("context_filter").array(),
    nexusSkills: text("nexus_skills").array(),
    mcpServers: text("mcp_servers").array(),
    status: varchar("status", { length: 32 }).notNull().default("pending"),
    dependsOn: uuid("depends_on").array(),
    model: varchar("model", { length: 128 }),
    mode: varchar("mode", { length: 16 }),
    fallbackChainPosition: integer("fallback_chain_position").default(0),
    attempt: integer("attempt").notNull().default(1),
    maxAttempts: integer("max_attempts").notNull().default(3),
    retryPolicy: jsonb("retry_policy"),
    lastError: text("last_error"),
    errorClass: varchar("error_class", { length: 64 }),
    tokensUsed: bigint("tokens_used", { mode: "number" }).default(0),
    costUsd: numeric("cost_usd", { precision: 10, scale: 4 }).default("0"),
    durationMs: bigint("duration_ms", { mode: "number" }),
    checkpointData: jsonb("checkpoint_data"),
    checkpointCount: integer("checkpoint_count").default(0),
    validationAttempts: integer("validation_attempts").default(0),
    validationResults: jsonb("validation_results"),
    prUrl: varchar("pr_url", { length: 512 }),
    prNumber: integer("pr_number"),
    prStatus: varchar("pr_status", { length: 32 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_tasks_work_item").on(table.workItemId),
    index("idx_tasks_status").on(table.status),
    index("idx_tasks_repo").on(table.repo),
    index("idx_tasks_scheduling").on(table.workItemId, table.status),
  ],
);
