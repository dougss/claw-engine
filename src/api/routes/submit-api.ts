import type { FastifyInstance } from "fastify";
import { Queue } from "bullmq";
import { and, desc, eq } from "drizzle-orm";
import { loadConfig } from "../../config.js";
import { classifyTask } from "../../core/classifier.js";
import type { TaskJobData } from "../../core/scheduler.js";
import type { getDb as GetDbType } from "../../storage/db.js";
import {
  createWorkItem,
} from "../../storage/repositories/work-items-repo.js";
import { createTask } from "../../storage/repositories/tasks-repo.js";
import { workItems, tasks } from "../../storage/schema/index.js";

type Db = ReturnType<typeof GetDbType>;

interface SubmitRequestBody {
  description: string;
  repos?: string[];
  source?: string;
  sourceRef?: string;
  model?: string;
  forceNew?: boolean;
  branch?: string;
  /**
   * Optional URL to POST when the work item reaches a terminal status.
   * Fire-and-forget. Caller's bridge can use this to close the loop without
   * holding an SSE follow open.
   */
  completionWebhook?: string;
}

/**
 * POST /api/v1/submit
 *
 * Submit a new task to the BullMQ queue (replaces `claw submit` CLI for
 * external integrations like dev-squad-bridge). Mirrors the logic in
 * src/cli/commands/submit.ts but adds:
 *
 * 1. Idempotency: when {source, sourceRef} are provided, an existing active
 *    work item with the same pair short-circuits the submit and returns the
 *    existing IDs (existing: true). Prevents duplicate runs when an upstream
 *    orchestrator (Paperclip adapter HTTP, n8n) re-fires for the same input.
 *
 * 2. Structured response: callers don't have to parse stdout.
 */
export function registerSubmitApiRoutes(app: FastifyInstance, db: Db): void {
  app.post("/submit", async (request, reply) => {
    const body = request.body as SubmitRequestBody | undefined;
    if (!body || typeof body.description !== "string" || body.description.trim() === "") {
      reply.code(400);
      return { error: "description is required" };
    }

    const description = body.description.trim();
    const repos = Array.isArray(body.repos) ? body.repos.filter(Boolean) : [];
    const source = body.source?.trim() || "api";
    const sourceRef = body.sourceRef?.trim() || null;

    // Idempotency check — strong: any prior WI for source+sourceRef wins,
    // regardless of status. Caller must pass forceNew=true to bypass (e.g.
    // explicit retry after manual review).
    if (sourceRef && !body.forceNew) {
      const existingWorkItems = await db
        .select()
        .from(workItems)
        .where(
          and(
            eq(workItems.source, source),
            eq(workItems.sourceRef, sourceRef),
          ),
        )
        .orderBy(desc(workItems.createdAt))
        .limit(1);

      if (existingWorkItems.length > 0) {
        const wi = existingWorkItems[0];
        const existingTasks = await db
          .select()
          .from(tasks)
          .where(eq(tasks.workItemId, wi.id))
          .limit(1);
        const existingTask = existingTasks[0];
        return reply.send({
          existing: true,
          workItemId: wi.id,
          taskId: existingTask?.id ?? null,
          status: wi.status,
          message: `deduplicated by source=${source} sourceRef=${sourceRef} (any prior WI; pass forceNew=true to retry)`,
        });
      }
    }

    const config = loadConfig();

    const completionWebhook =
      typeof body.completionWebhook === "string" && body.completionWebhook.trim()
        ? body.completionWebhook.trim()
        : undefined;

    const wi = await createWorkItem(db, {
      title: description.slice(0, 200),
      description,
      repos,
      source,
      sourceRef: sourceRef ?? undefined,
      completionWebhook,
    });

    let complexity: "simple" | "medium" | "complex" = "medium";
    const apiKey = process.env[config.providers.alibaba.api_key_env] ?? "";
    if (apiKey) {
      try {
        const classification = await classifyTask(description, {
          apiKey,
          baseUrl: config.providers.alibaba.base_url,
          model: config.models.default,
        });
        complexity = classification.complexity;
      } catch {
        complexity = "medium";
      }
    }

    const repo = repos.length > 0 ? repos[0]! : process.cwd();
    let branch: string;
    if (body.branch && /^[a-z0-9/_.-]+$/i.test(body.branch)) {
      branch = body.branch;
    } else {
      const slug = description
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 40);
      const timestamp = Date.now().toString(36);
      branch = `claw/${slug}-${timestamp}`;
    }

    const provider = complexity === "complex" ? "anthropic" : "opencode";
    const model =
      body.model ??
      (provider === "opencode"
        ? config.providers.opencode.default_model
        : "claude-sonnet");

    const task = await createTask(db, {
      workItemId: wi.id,
      repo,
      branch,
      description,
      complexity,
      model,
      estimatedTokens: 1000,
      dagNodeId: `task-${wi.id}-0`,
    });

    const queueName = `claw-${provider}`;
    const queue = new Queue<TaskJobData>(queueName, {
      connection: {
        host: config.redis.host,
        port: config.redis.port,
        maxRetriesPerRequest: 0,
      },
    });

    const jobData: TaskJobData = {
      taskId: task.id,
      dagNodeId: task.dagNodeId,
      repo,
      branch,
      description,
      complexity,
      estimatedTokens: 1000,
      workItemId: wi.id,
      dependsOn: [],
      provider,
    };

    await queue.add(task.dagNodeId, jobData, {
      jobId: `${wi.id}-${task.id}`,
    });
    await queue.close();

    return reply.send({
      existing: false,
      workItemId: wi.id,
      taskId: task.id,
      branch,
      queue: queueName,
      complexity,
      provider,
      source,
      sourceRef,
    });
  });
}
