import type { FastifyInstance } from "fastify";
import { v4 as uuidv4 } from "uuid";
import type { getDb as GetDbType } from "../../storage/db.js";
import { createWorkItem, updateWorkItemStatus } from "../../storage/repositories/work-items-repo.js";
import { createTask, updateTaskStatus } from "../../storage/repositories/tasks-repo.js";
import { routeTask } from "../../core/router.js";
import { loadConfig } from "../../config.js";
import { runClaudePipe } from "../../integrations/claude-p/claude-pipe.js";
import { runOpencodePipe } from "../../integrations/opencode/opencode-pipe.js";
import { insertTelemetryEvent } from "../../storage/repositories/telemetry-repo.js";
import { publishEvent } from "../sse.js";
import { eq } from "drizzle-orm";
import { tasks, workItems } from "../../storage/schema/index.js";

type Db = ReturnType<typeof GetDbType>;

interface RunRequestBody {
  repo: string;
  prompt: string;
  model?: string;
}

// Update the publishEvent function to support task-specific channels
async function publishTaskEvent(
  redis: any,
  taskId: string,
  event: Omit<{ id: number; type: string; data: unknown }, "id">
): Promise<void> {
  const SSE_CHANNEL = `claw:events:task:${taskId}`;
  const SSE_BUFFER_KEY = `claw:events:buffer:task:${taskId}`;
  const SSE_MAX_BUFFER = 500;

  // Get next id via INCR
  const id = await redis.incr(`claw:events:task:${taskId}:seq`);
  const payload = { ...event, id };
  const serialized = JSON.stringify(payload);

  // Push to circular buffer (trim to max 500)
  await redis
    .multi()
    .rpush(SSE_BUFFER_KEY, serialized)
    .ltrim(SSE_BUFFER_KEY, -SSE_MAX_BUFFER, -1)
    .publish(SSE_CHANNEL, serialized)
    .exec();
}

/** Handle a single task-specific SSE connection */
async function handleTaskSseConnection(
  redis: any,
  taskId: string,
  subscriberRedis: any,
  reply: any,
  lastEventId?: string,
): Promise<void> {
  const SSE_CHANNEL = `claw:events:task:${taskId}`;
  const SSE_BUFFER_KEY = `claw:events:buffer:task:${taskId}`;

  reply.raw.setHeader("Content-Type", "text/event-stream");
  reply.raw.setHeader("Cache-Control", "no-cache");
  reply.raw.setHeader("Connection", "keep-alive");
  reply.raw.setHeader("X-Accel-Buffering", "no");
  reply.raw.flushHeaders();

  function send(event: { id: number; type: string; data: unknown }): void {
    reply.raw.write(`id: ${event.id}\n`);
    reply.raw.write(`event: ${event.type}\n`);
    reply.raw.write(`data: ${JSON.stringify(event.data)}\n\n`);
  }

  // Replay buffered events if reconnecting
  if (lastEventId !== undefined && lastEventId !== "") {
    const since = parseInt(lastEventId, 10);
    if (!Number.isNaN(since)) {
      const raw = await redis.lrange(SSE_BUFFER_KEY, 0, -1);
      const events = raw
        .map((s: string) => JSON.parse(s))
        .filter((e: { id: number }) => e.id > since);
      for (const evt of events) send(evt);
    }
  }

  // Subscribe to new events
  await subscriberRedis.subscribe(SSE_CHANNEL);

  const onMessage = (_channel: string, message: string) => {
    try {
      const evt = JSON.parse(message);
      send(evt);
    } catch {
      // ignore malformed messages
    }
  };

  subscriberRedis.on("message", onMessage);

  // Keep-alive ping every 15s
  const pingInterval = setInterval(() => {
    reply.raw.write(": ping\n\n");
  }, 15_000);

  reply.raw.on("close", () => {
    clearInterval(pingInterval);
    subscriberRedis.off("message", onMessage);
    subscriberRedis.unsubscribe(SSE_CHANNEL).catch(() => {});
  });

  // Wait until client disconnects
  await new Promise<void>((resolve) => {
    reply.raw.on("close", resolve);
  });
}

export function registerRunApiRoutes(app: FastifyInstance, db: Db, redis: any): void {
  // POST /api/v1/run - Submit a new task
  app.post("/run", async (request, reply) => {
    const { repo, prompt, model } = request.body as RunRequestBody;
    
    // Validate inputs
    if (!repo || !prompt) {
      reply.status(400);
      return { error: "repo and prompt are required" };
    }

    // Validate that repo is an absolute path
    if (!repo.startsWith("/")) {
      reply.status(400);
      return { error: "repo must be an absolute path" };
    }

    try {
      const config = loadConfig();

      // Classify task complexity (similar to cli/run.ts)
      let complexity: "simple" | "medium" | "complex" = "medium";
      const apiKey = process.env[config.providers.alibaba.api_key_env] ?? "";
      if (apiKey) {
        // We'll use classifyTask here, but since we can't import it directly,
        // we'll default to medium for now. This would normally call classifyTask.
        // For now, we'll proceed with medium complexity.
      }

      // Determine routing decision
      const route = routeTask(
        { complexity, description: prompt, fallbackChainPosition: 0 },
        config,
      );
      
      const effectiveRoute = model
        ? {
            ...route,
            model: model,
          }
        : route;

      // Create work item
      const workItem = await createWorkItem(db, {
        title: prompt.slice(0, 120),
        description: prompt,
        repos: [repo.split('/').pop() || repo],
        source: "api:remote",
      });

      // Create task
      const branch = `claw-api-${Date.now()}`;
      const task = await createTask(db, {
        workItemId: workItem.id,
        repo: repo.split('/').pop() || repo,
        branch,
        description: prompt,
        complexity,
        model: model ?? effectiveRoute.model,
        dagNodeId: `task-${Date.now()}`,
      });

      // Update work item status to running
      await updateWorkItemStatus(db, workItem.id, "running");

      // Send response early with task info
      const taskId = task.id;
      const streamUrl = `/api/v1/tasks/${taskId}/stream`;
      reply.status(202); // Accepted
      reply.send({ taskId, streamUrl });

      // Track routing decision in telemetry
      void insertTelemetryEvent(db, {
        taskId: task.id,
        eventType: "routing_decision",
        payload: {
          complexity,
          mode: effectiveRoute.mode,
          reason: effectiveRoute.reason,
        },
      }).catch(() => {});

      // Spawn delegate pipe based on routing decision
      try {
        const delegateProvider = effectiveRoute.provider;
        const delegateEvents =
          delegateProvider === "opencode"
            ? runOpencodePipe({
                prompt,
                model: model ?? config.providers.opencode.default_model,
                opencodeBin: config.providers.opencode.binary,
                workspacePath: repo,
              })
            : runClaudePipe({
                prompt,
                model: model ?? effectiveRoute.model,
                claudeBin: config.providers.anthropic.binary,
                workspacePath: repo,
              });

        // Process events and stream them
        let endReason = "completed";
        for await (const event of delegateEvents) {
          // Publish event to task-specific SSE channel
          await publishTaskEvent(redis, taskId, {
            type: event.type,
            data: {
              taskId,
              ...event,
            },
          });

          // Track certain events in telemetry
          if (event.type === "tool_use" && task.id) {
            void insertTelemetryEvent(db, {
              taskId: task.id,
              eventType: "tool_use",
              payload: { name: event.name, input: event.input },
            }).catch(() => {});
          } else if (event.type === "token_update" && task.id) {
            void insertTelemetryEvent(db, {
              taskId: task.id,
              eventType: "token_update",
              payload: {
                used: event.used,
                budget: event.budget,
                percent: event.percent,
              },
            }).catch(() => {});
          } else if (event.type === "session_end" && task.id) {
            endReason = event.reason;
            void insertTelemetryEvent(db, {
              taskId: task.id,
              eventType: "session_end",
              payload: { reason: event.reason },
            }).catch(() => {});
          }
        }

        // Update task and work item status based on completion
        const taskStatus =
          endReason === "completed"
            ? "completed"
            : endReason === "interrupted"
              ? "interrupted"
              : "failed";
        const wiStatus =
          endReason === "completed"
            ? "completed"
            : endReason === "interrupted"
              ? "interrupted"
              : "failed";
        
        await updateTaskStatus(db, task.id, taskStatus);
        await updateWorkItemStatus(db, workItem.id, wiStatus);

      } catch (error) {
        console.error("Error running delegate pipe:", error);
        
        // Update task and work item to failed status
        await updateTaskStatus(db, task.id, "failed");
        await updateWorkItemStatus(db, workItem.id, "failed");
          
        // Publish error event
        await publishTaskEvent(redis, taskId, {
          type: "error",
          data: {
            taskId: task.id,
            error: (error as Error).message,
          },
        });
      }
    } catch (error) {
      console.error("Error submitting task:", error);
      reply.status(500);
      return { error: "internal server error" };
    }
  });

  // GET /api/v1/tasks/:id/stream - SSE stream for a specific task
  app.get("/tasks/:id/stream", async (request, reply) => {
    const { id } = request.params as { id: string };
    
    // Validate that task exists
    const task = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, id))
      .limit(1);
    
    if (!task.length) {
      reply.status(404);
      return { error: "task not found" };
    }

    const lastEventId = (request.headers["last-event-id"] as string) ?? "";
    const config = loadConfig();
    const subscriberRedis = new (await import("ioredis")).Redis({
      host: config.redis.host,
      port: config.redis.port,
    });
    
    try {
      await handleTaskSseConnection(redis, id, subscriberRedis, reply, lastEventId);
    } catch (error) {
      console.error("Error in SSE connection:", error);
      try {
        await subscriberRedis.disconnect();
      } catch {}
    }
  });
}