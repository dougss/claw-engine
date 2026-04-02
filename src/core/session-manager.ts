import type { Message, ToolDefinition, ToolResult } from "../types.js";
import type { HarnessEvent } from "../harness/events.js";
import type { ModelAdapter } from "../harness/model-adapters/adapter-types.js";
import type { ToolHandler } from "../harness/tools/tool-types.js";
import type { PermissionRule } from "../harness/permissions.js";
import { createQueryEngineConfig } from "../harness/query-engine-config.js";
import { createQueryEnginePort } from "../harness/query-engine-port.js";
import {
  createMemorySessionStore,
  createPostgresSessionStore,
  type SessionStore,
} from "../harness/session-store.js";

/** Checkpoint data from a previous session used to resume work. */
export interface ResumeCheckpoint {
  /** Summary text produced by the agent before the checkpoint. */
  summary: string;
  /** Recent messages for context continuity. */
  recentMessages?: Message[];
}

export async function createProductionSessionStore(
  connectionString?: string,
): Promise<SessionStore> {
  if (!connectionString) {
    console.warn(
      "[session-manager] No DB connection string — using in-memory session store",
    );
    return createMemorySessionStore();
  }

  try {
    const { getDb } = await import("../storage/db.js");
    const {
      getTaskCheckpointData,
      setTaskCheckpointData,
      listTasksWithCheckpoint,
    } = await import("../storage/repositories/tasks-repo.js");

    const db = getDb({ connectionString });

    return createPostgresSessionStore({
      getTaskCheckpointData: (taskId) => getTaskCheckpointData(db, taskId),
      setTaskCheckpointData: (taskId, data) =>
        setTaskCheckpointData(db, taskId, data),
      listTasksWithCheckpoint: () => listTasksWithCheckpoint(db),
    });
  } catch (err) {
    console.warn(
      "[session-manager] DB unavailable — falling back to in-memory session store:",
      err instanceof Error ? err.message : err,
    );
    return createMemorySessionStore();
  }
}

export async function runSingleSession({
  adapter,
  systemPrompt,
  userPrompt,
  tools,
  workspacePath,
  maxIterations,
  toolHandlers,
  resumeCheckpoint,
  checkpointThresholdPercent,
  sessionId,
  permissionRules,
  mcpCallTool,
  sessionStore,
}: {
  adapter: ModelAdapter;
  systemPrompt: string;
  userPrompt: string;
  tools: ToolDefinition[];
  workspacePath: string;
  maxIterations: number;
  toolHandlers?: Map<string, ToolHandler>;
  resumeCheckpoint?: ResumeCheckpoint;
  checkpointThresholdPercent?: number;
  sessionId?: string;
  permissionRules?: PermissionRule[];
  mcpCallTool?: (name: string, input: unknown) => Promise<ToolResult>;
  sessionStore?: SessionStore;
}): Promise<{ events: HarnessEvent[]; endReason: string }> {
  // Build effective system prompt: append checkpoint block if resuming
  let effectiveSystemPrompt = systemPrompt;
  if (resumeCheckpoint) {
    const checkpointBlock = [
      "\n\n---\n\nCHECKPOINT",
      JSON.stringify(
        {
          summary: resumeCheckpoint.summary,
          recentMessages: resumeCheckpoint.recentMessages ?? [],
        },
        null,
        2,
      ),
    ].join("\n");
    effectiveSystemPrompt = systemPrompt + checkpointBlock;
  }

  const config = createQueryEngineConfig({
    maxTurns: maxIterations,
    workspacePath,
    sessionId: sessionId ?? `session-${Date.now()}`,
    checkpointThreshold: checkpointThresholdPercent
      ? checkpointThresholdPercent / 100
      : undefined,
    maxTokens: adapter.maxContext,
  });

  const resolvedSessionStore = sessionStore ?? createMemorySessionStore();
  const port = createQueryEnginePort({
    config,
    adapter,
    sessionStore: resolvedSessionStore,
    systemPrompt: effectiveSystemPrompt,
    tools,
    toolHandlers,
    permissionRules,
    mcpCallTool,
  });

  const events: HarnessEvent[] = [];
  let endReason = "unknown";

  for await (const event of port.run(userPrompt)) {
    events.push(event);
    if (event.type === "session_end") {
      endReason = event.reason;
    }
  }

  return { events, endReason };
}
