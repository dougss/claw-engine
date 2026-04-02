import { loadConfig } from "../../config.js";
import { getDb } from "../../storage/db.js";
import {
  getWorkItemById,
  updateWorkItemStatus,
} from "../../storage/repositories/work-items-repo.js";
import {
  getTasksByWorkItemId,
  getTaskCheckpointData,
  updateTaskStatus,
} from "../../storage/repositories/tasks-repo.js";
import { createProductionSessionStore } from "../../core/session-manager.js";
import { createQueryEnginePort } from "../../harness/query-engine-port.js";
import {
  createQueryEngineConfig,
  TOOL_PROFILE,
} from "../../harness/query-engine-config.js";
import { createAlibabaAdapter } from "../../harness/model-adapters/alibaba-adapter.js";
import { withRetry } from "../../harness/model-adapters/with-retry.js";
import { loadProjectContext } from "../../harness/context-builder.js";
import { DEFAULT_PERMISSION_RULES } from "../../harness/permissions.js";
import { readFileTool } from "../../harness/tools/builtins/read-file.js";
import { writeFileTool } from "../../harness/tools/builtins/write-file.js";
import { editFileTool } from "../../harness/tools/builtins/edit-file.js";
import { bashTool } from "../../harness/tools/builtins/bash.js";
import { globTool } from "../../harness/tools/builtins/glob-tool.js";
import { grepTool } from "../../harness/tools/builtins/grep-tool.js";
import type { ToolHandler } from "../../harness/tools/tool-types.js";

export function registerResumeCommand(program: import("commander").Command) {
  program
    .command("resume <work-item-id>")
    .description("Resume a paused work item")
    .action(async (workItemId: string) => {
      const config = loadConfig();
      const connStr =
        process.env.CLAW_ENGINE_DATABASE_URL ??
        (() => {
          const pw =
            process.env[config.database.password_env] ?? "claw_engine_local";
          return `postgresql://${config.database.user}:${pw}@${config.database.host}:${config.database.port}/${config.database.database}`;
        })();

      try {
        const db = getDb({ connectionString: connStr });

        const workItem = await getWorkItemById(db, workItemId);
        if (!workItem) {
          console.error(`Work item ${workItemId} not found.`);
          process.exit(1);
        }

        const tasks = await getTasksByWorkItemId(db, workItemId);
        if (tasks.length === 0) {
          console.error(`No tasks found for work item ${workItemId}.`);
          process.exit(1);
        }

        // Find first task with a saved checkpoint
        let taskToResume = null;
        for (const task of tasks) {
          const checkpointData = await getTaskCheckpointData(db, task.id);
          if (checkpointData) {
            taskToResume = task;
            break;
          }
        }

        if (!taskToResume) {
          console.error(
            `No checkpointed task found for work item ${workItemId}.`,
          );
          process.exit(1);
        }

        console.log(
          `Resuming work item ${workItemId} (task ${taskToResume.id})...`,
        );

        await updateWorkItemStatus(db, workItemId, "running");
        await updateTaskStatus(db, taskToResume.id, "running");

        // Use production session store (with real setTaskCheckpointData)
        const sessionStore = await createProductionSessionStore(connStr);

        // Recover workspacePath from the saved checkpoint config
        const checkpointData = await getTaskCheckpointData(db, taskToResume.id);
        const savedWorkspacePath = (
          checkpointData?.config as Record<string, unknown> | null
        )?.workspacePath as string | undefined;
        const repoPath = savedWorkspacePath ?? process.cwd();

        const projectContext = await loadProjectContext(repoPath);

        const engineConfig = createQueryEngineConfig({
          maxTurns: 200,
          maxTokens: 128_000,
          workspacePath: repoPath,
          sessionId: taskToResume.id,
          toolProfile: TOOL_PROFILE.full,
        });

        const model = taskToResume.model ?? config.models.default;

        const apiKeyEnv = config.providers.alibaba.api_key_env;
        const apiKey = process.env[apiKeyEnv];
        if (!apiKey) {
          console.error(`Resume requires ${apiKeyEnv} env var.`);
          process.exit(1);
        }

        const baseAdapter = createAlibabaAdapter({
          name: "qwen-resume",
          model,
          apiKey,
          baseUrl: config.providers.alibaba.base_url,
        });

        const fallbackChain = config.models.fallback_chain;
        const fallbackChainPosition = Math.max(
          0,
          fallbackChain.findIndex((t) => t.model === model),
        );

        const adapter = withRetry(baseAdapter, {
          fallbackChainPosition,
          config,
          apiKey,
          baseUrl: config.providers.alibaba.base_url,
        });

        const builtins: ToolHandler[] = [
          readFileTool,
          writeFileTool,
          editFileTool,
          bashTool,
          globTool,
          grepTool,
        ];
        const toolHandlers = new Map<string, ToolHandler>(
          builtins.map((t) => [t.name, t]),
        );
        const toolDefinitions = builtins.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        }));

        const port = createQueryEnginePort({
          config: engineConfig,
          adapter,
          systemPrompt: [
            `You are resuming a coding task in the repository at ${repoPath}.`,
            "Continue exactly where you left off.",
            ...(projectContext
              ? ["", "## Project Context", projectContext]
              : []),
          ].join("\n"),
          tools: toolDefinitions,
          sessionStore,
          toolHandlers,
          permissionRules: DEFAULT_PERMISSION_RULES,
        });

        for await (const event of port.resume(taskToResume.id)) {
          if (event.type === "text_delta") {
            process.stdout.write(event.text);
          } else if (event.type === "tool_use") {
            const input = JSON.stringify(event.input ?? {});
            const preview =
              input.length > 60 ? input.slice(0, 57) + "..." : input;
            process.stderr.write(`\n[tool] ${event.name}(${preview})\n`);
          } else if (event.type === "token_update") {
            process.stderr.write(
              `\r[tokens] ${event.used.toLocaleString()} / ${event.budget.toLocaleString()} (${event.percent}%)   `,
            );
          } else if (event.type === "session_resume") {
            process.stderr.write(
              `\n⟳ Resuming session (pass ${event.resumeCount})\n`,
            );
          } else if (event.type === "session_end") {
            process.stderr.write("\n");

            const isCheckpoint = event.reason === "checkpoint";
            const isComplete = event.reason === "completed";
            const taskStatus = isComplete
              ? "completed"
              : isCheckpoint
                ? "paused"
                : "failed";
            const wiStatus = isComplete
              ? "completed"
              : isCheckpoint
                ? "paused"
                : "failed";

            await updateTaskStatus(db, taskToResume.id, taskStatus);
            await updateWorkItemStatus(db, workItemId, wiStatus);

            if (isComplete) console.log("\n✅ done");
            else if (isCheckpoint) console.log("\n📍 checkpoint saved");
            else console.log(`\n⚠️  ended: ${event.reason}`);
            break;
          }
        }
      } catch (error) {
        console.error(
          "Error resuming work item:",
          error instanceof Error ? error.message : String(error),
        );
        process.exit(1);
      }
    });
}
