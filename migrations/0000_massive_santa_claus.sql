CREATE TABLE "cost_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
	"period_type" varchar(16) NOT NULL,
	"period_start" date NOT NULL,
	"claude_tokens" bigint DEFAULT 0 NOT NULL,
	"alibaba_tokens" bigint DEFAULT 0 NOT NULL,
	"total_tokens" bigint DEFAULT 0 NOT NULL,
	"alibaba_cost_usd" numeric(10, 4) DEFAULT '0' NOT NULL,
	"estimated_claude_cost_usd" numeric(10, 4) DEFAULT '0' NOT NULL,
	"estimated_savings_usd" numeric(10, 4) DEFAULT '0' NOT NULL,
	"sessions_total" integer DEFAULT 0 NOT NULL,
	"sessions_engine" integer DEFAULT 0 NOT NULL,
	"sessions_delegate" integer DEFAULT 0 NOT NULL,
	"work_items_completed" integer DEFAULT 0 NOT NULL,
	"escalations" integer DEFAULT 0 NOT NULL,
	"first_pass_success_rate" numeric(5, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_cost_period" UNIQUE("period_type","period_start")
);
--> statement-breakpoint
CREATE TABLE "routing_history" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
	"task_id" uuid NOT NULL,
	"task_pattern" varchar(256) NOT NULL,
	"repo" varchar(256) NOT NULL,
	"complexity" varchar(16) NOT NULL,
	"keywords" text[],
	"model" varchar(128) NOT NULL,
	"success" boolean NOT NULL,
	"tokens_used" bigint,
	"duration_ms" bigint,
	"validation_first_pass" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_telemetry" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
	"task_id" uuid NOT NULL,
	"correlation_id" uuid NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
	"work_item_id" uuid NOT NULL,
	"dag_node_id" varchar(64) NOT NULL,
	"repo" varchar(256) NOT NULL,
	"branch" varchar(256) NOT NULL,
	"worktree_path" varchar(512),
	"description" text NOT NULL,
	"complexity" varchar(16) DEFAULT 'medium' NOT NULL,
	"context_filter" text[],
	"nexus_skills" text[],
	"mcp_servers" text[],
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"depends_on" uuid[],
	"model" varchar(128),
	"mode" varchar(16),
	"fallback_chain_position" integer DEFAULT 0,
	"attempt" integer DEFAULT 1 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"retry_policy" jsonb,
	"last_error" text,
	"error_class" varchar(64),
	"tokens_used" bigint DEFAULT 0,
	"cost_usd" numeric(10, 4) DEFAULT '0',
	"duration_ms" bigint,
	"checkpoint_data" jsonb,
	"checkpoint_count" integer DEFAULT 0,
	"validation_attempts" integer DEFAULT 0,
	"validation_results" jsonb,
	"pr_url" varchar(512),
	"pr_number" integer,
	"pr_status" varchar(32),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "work_items" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
	"title" varchar(512) NOT NULL,
	"description" text,
	"source" varchar(64) NOT NULL,
	"source_ref" varchar(512),
	"status" varchar(32) DEFAULT 'queued' NOT NULL,
	"priority" integer DEFAULT 3 NOT NULL,
	"dag" jsonb,
	"total_tokens_used" bigint DEFAULT 0,
	"total_cost_usd" numeric(10, 4) DEFAULT '0',
	"tasks_total" integer DEFAULT 0,
	"tasks_completed" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "routing_history" ADD CONSTRAINT "routing_history_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_telemetry" ADD CONSTRAINT "session_telemetry_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_routing_pattern" ON "routing_history" USING btree ("task_pattern");--> statement-breakpoint
CREATE INDEX "idx_routing_model" ON "routing_history" USING btree ("model","success");--> statement-breakpoint
CREATE INDEX "idx_routing_created" ON "routing_history" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_telemetry_task" ON "session_telemetry" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "idx_telemetry_correlation" ON "session_telemetry" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "idx_telemetry_type" ON "session_telemetry" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "idx_telemetry_created" ON "session_telemetry" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_tasks_work_item" ON "tasks" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "idx_tasks_status" ON "tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_tasks_repo" ON "tasks" USING btree ("repo");--> statement-breakpoint
CREATE INDEX "idx_tasks_scheduling" ON "tasks" USING btree ("work_item_id","status");--> statement-breakpoint
CREATE INDEX "idx_work_items_status" ON "work_items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_work_items_created" ON "work_items" USING btree ("created_at");