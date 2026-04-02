import type { ToolDefinition, ToolResult } from "../types.js";
import type { HarnessEvent } from "./events.js";
import type { ModelAdapter } from "./model-adapters/adapter-types.js";
import type { QueryEngineConfig } from "./query-engine-config.js";
import type { ToolHandler } from "./tools/tool-types.js";
import type { PermissionRule } from "./permissions.js";
import { DEFAULT_PERMISSION_RULES } from "./permissions.js";
import {
  createTranscriptStore,
  type TranscriptStore,
} from "./transcript-store.js";
import { createUsageTracker, type UsageTracker } from "./usage-tracker.js";
import {
  createMemorySessionStore,
  type SessionStore,
  type SessionState,
} from "./session-store.js";
import { assembleToolPool } from "./tool-pool.js";
import { runAgentLoop } from "./agent-loop.js";

export interface QueryEnginePortOptions {
  config: QueryEngineConfig;
  adapter: ModelAdapter;
  systemPrompt?: string;
  tools?: ToolDefinition[];
  sessionStore?: SessionStore;
  toolHandlers?: Map<string, ToolHandler>;
  permissionRules?: PermissionRule[];
  mcpCallTool?: (name: string, input: unknown) => Promise<ToolResult>;
}

export interface QueryEnginePort {
  config: QueryEngineConfig;
  run(userPrompt: string): AsyncGenerator<HarnessEvent>;
  resume(sessionId: string): AsyncGenerator<HarnessEvent>;
}

export function createQueryEnginePort({
  config,
  adapter,
  systemPrompt: providedSystemPrompt,
  tools: providedTools,
  sessionStore = createMemorySessionStore(),
  toolHandlers,
  permissionRules = DEFAULT_PERMISSION_RULES,
  mcpCallTool,
}: QueryEnginePortOptions): QueryEnginePort {
  async function* run(userPrompt: string): AsyncGenerator<HarnessEvent> {
    const transcript = createTranscriptStore({
      systemPrompt: providedSystemPrompt ?? buildSystemPromptPlaceholder(),
      userPrompt,
    });
    const usage = createUsageTracker();

    yield* orchestrate({
      transcript,
      usage,
      config,
      adapter,
      tools: providedTools,
      sessionStore,
      toolHandlers,
      permissionRules,
      mcpCallTool,
    });
  }

  async function* resume(sessionId: string): AsyncGenerator<HarnessEvent> {
    const saved = await sessionStore.load(sessionId);
    if (!saved) {
      yield { type: "session_end", reason: "error" };
      return;
    }

    const systemPrompt =
      saved.transcript.messages.find((m) => m.role === "system")?.content ?? "";
    const userPrompt =
      saved.transcript.messages.find((m) => m.role === "user")?.content ?? "";

    const transcript = createTranscriptStore({
      systemPrompt,
      userPrompt,
      fromSerialized: saved.transcript,
    });
    const usage = createUsageTracker({ fromSerialized: saved.usage });

    yield* orchestrate({
      transcript,
      usage,
      config: saved.config ?? config,
      adapter,
      tools: providedTools,
      sessionStore,
      toolHandlers,
      permissionRules,
      mcpCallTool,
    });
  }

  return { config, run, resume };
}

function buildSystemPromptPlaceholder(): string {
  return [
    "IDENTITY",
    "You are a coding agent.",
    "Follow instructions precisely and stay deterministic.",
  ].join("\n");
}

function resolveTools({
  config,
  toolHandlers,
  tools,
}: {
  config: QueryEngineConfig;
  toolHandlers?: Map<string, ToolHandler>;
  tools?: ToolDefinition[];
}): {
  definitions: ToolDefinition[];
  handlers: Map<string, ToolHandler> | undefined;
} {
  // Explicit tools/handlers take priority
  if (tools || toolHandlers) {
    const definitions = tools
      ? tools
      : Array.from(toolHandlers!.values()).map((h) => ({
          name: h.name,
          description: h.description,
          inputSchema: h.inputSchema,
        }));
    return { definitions, handlers: toolHandlers };
  }

  // Fall back to ToolPool assembled from config.toolProfile
  const pool = assembleToolPool({ config });
  return {
    definitions: pool.getDefinitions(),
    handlers: new Map(pool.tools.map((t) => [t.name, t])),
  };
}

async function* orchestrate({
  transcript,
  usage,
  config,
  adapter,
  tools,
  sessionStore,
  toolHandlers,
  permissionRules,
  mcpCallTool,
}: {
  transcript: TranscriptStore;
  usage: UsageTracker;
  config: QueryEngineConfig;
  adapter: ModelAdapter;
  tools?: ToolDefinition[];
  sessionStore: SessionStore;
  toolHandlers?: Map<string, ToolHandler>;
  permissionRules: PermissionRule[];
  mcpCallTool?: (name: string, input: unknown) => Promise<ToolResult>;
}): AsyncGenerator<HarnessEvent> {
  const mutableMessages = transcript.getMutableMessages();

  const systemPrompt = mutableMessages[0]?.content ?? "";
  const userPrompt =
    mutableMessages.find((m) => m.role === "user")?.content ?? "";

  const { definitions: toolDefinitions, handlers: resolvedHandlers } =
    resolveTools({ config, toolHandlers, tools });

  const sharedLoopArgs = {
    adapter,
    systemPrompt,
    userPrompt,
    messages: mutableMessages,
    tools: toolDefinitions,
    maxIterations: config.maxTurns,
    tokenBudget: config.maxTokens,
    workspacePath: config.workspacePath,
    toolHandlers: resolvedHandlers,
    sessionId: config.sessionId,
    workItemId: config.workItemId,
    permissionRules,
    mcpCallTool,
  } as const;

  // Maximum compaction passes before forcing a real checkpoint.
  const MAX_COMPACTION_PASSES = 10;

  let passCount = 0;
  let lastTokenPercent = 0;

  while (passCount < MAX_COMPACTION_PASSES) {
    passCount += 1;
    transcript.microcompact();
    const isLastPass = passCount >= MAX_COMPACTION_PASSES;

    const checkpointPercent = isLastPass
      ? Math.round(config.checkpointThreshold * 100)
      : Math.round(config.compactionThreshold * 100);

    let bufferedCheckpoint: HarnessEvent | null = null;
    let didEnd = false;
    let endReason: string | null = null;

    for await (const event of runAgentLoop({
      ...sharedLoopArgs,
      checkpointThresholdPercent: checkpointPercent,
    })) {
      if (event.type === "tool_use") {
        usage.addToolCall();
      }

      if (event.type === "permission_denied") {
        usage.addPermissionDenial();
      }

      if (event.type === "token_update") {
        lastTokenPercent = event.percent;
        usage.updateTokenPercent(event.percent);
      }

      if (event.type === "checkpoint") {
        bufferedCheckpoint = event;
        continue;
      }

      if (event.type === "session_end") {
        didEnd = true;
        endReason = event.reason;

        const canCompactAndContinue =
          !isLastPass &&
          event.reason === "checkpoint" &&
          transcript.shouldCompact({
            config,
            currentTokenPercent: lastTokenPercent,
          });

        if (canCompactAndContinue) {
          const messagesBefore = mutableMessages.length;
          await transcript.compact({ config, adapter });
          const messagesAfter = mutableMessages.length;

          yield {
            type: "compaction",
            messagesBefore,
            messagesAfter,
            compactionCount: transcript.compactionCount,
          };

          break;
        }

        if (event.reason === "checkpoint" && bufferedCheckpoint) {
          yield bufferedCheckpoint;
        }

        if (event.reason === "checkpoint") {
          const state: SessionState = {
            sessionId: config.sessionId,
            config,
            transcript: transcript.toSerializable(),
            usage: usage.toSerializable(),
            metadata: {
              startedAt: new Date().toISOString(),
              lastActivityAt: new Date().toISOString(),
              status: "checkpointed",
            },
          };
          await sessionStore.save(state);
        }

        yield event;
        return;
      }

      yield event;
    }

    if (!didEnd) {
      break;
    }

    if (endReason !== "checkpoint") {
      break;
    }
  }
}
