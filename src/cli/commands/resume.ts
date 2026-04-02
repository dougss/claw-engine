import { loadConfig } from "../../config.js";
import { getDb } from "../../storage/db.js";
import { getWorkItemById, updateWorkItemStatus } from "../../storage/repositories/work-items-repo.js";
import { getTasksByWorkItemId, getTaskCheckpointData, updateTaskStatus } from "../../storage/repositories/tasks-repo.js";
import { getTelemetryByTaskId } from "../../storage/repositories/telemetry-repo.js";
import { createPostgresSessionStore } from "../../harness/session-store.js";
import { createQueryEnginePort } from "../../harness/query-engine-port.js";
import { createQueryEngineConfig, TOOL_PROFILE } from "../../harness/query-engine-config.js";
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
import { routeTask } from "../../core/router.js";
import { classifyTask } from "../../core/classifier.js";
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
        
        // Check if work item exists
        const workItem = await getWorkItemById(db, workItemId);
        if (!workItem) {
          console.error(`Work item with ID ${workItemId} not found.`);
          process.exit(1);
        }
        
        // Get associated tasks
        const tasks = await getTasksByWorkItemId(db, workItemId);
        if (tasks.length === 0) {
          console.error(`No tasks found for work item ${workItemId}.`);
          process.exit(1);
        }
        
        // Find a task that has checkpoint data to resume from
        let taskToResume = null;
        for (const task of tasks) {
          const checkpointData = await getTaskCheckpointData(db, task.id);
          if (checkpointData) {
            taskToResume = task;
            break;
          }
        }
        
        if (!taskToResume) {
          console.error(`No checkpointed task found for work item ${workItemId}. Cannot resume.`);
          process.exit(1);
        }
        
        console.log(`Resuming work item ${workItemId} from task ${taskToResume.id}...`);
        
        // Update work item status to running
        await updateWorkItemStatus(db, workItemId, 'running');
        console.log(`Work item ${workItemId} status updated to running.`);
        
        // Update task status to running
        await updateTaskStatus(db, taskToResume.id, 'running');
        console.log(`Task ${taskToResume.id} status updated to running.`);
        
        // Create session store for PostgreSQL
        const sessionStore = createPostgresSessionStore({
          getTaskCheckpointData: (taskId: string) => getTaskCheckpointData(db, taskId),
          setTaskCheckpointData: async (taskId: string, data: Record<string, unknown> | null) => {
            // We'll handle setting checkpoint data later when we have the session running
          },
          listTasksWithCheckpoint: async () => {
            // Return all tasks with checkpoint data for this work item
            const allTasks = await getTasksByWorkItemId(db, workItemId);
            const checkpointedTasks = [];
            for (const task of allTasks) {
              const checkpointData = await getTaskCheckpointData(db, task.id);
              if (checkpointData) {
                checkpointedTasks.push(task.id);
              }
            }
            return checkpointedTasks;
          }
        });
        
        // Get project context for the task's repo
        const repoPath = process.cwd(); // For now, assume we're in the right repo
        const projectContext = await loadProjectContext(repoPath);
        
        // Prepare configuration for query engine
        const engineConfig = createQueryEngineConfig({
          maxTurns: 200,
          maxTokens: 128000, // Qwen max context
          workspacePath: repoPath,
          sessionId: taskToResume.id,
          toolProfile: TOOL_PROFILE.full,
        });
        
        // Determine model to use based on task or default
        let model = config.models.default;
        if (taskToResume.model) {
          model = taskToResume.model;
        }
        
        // Route the task to determine the appropriate mode
        let complexity: "simple" | "medium" | "complex" = taskToResume.complexity as "simple" | "medium" | "complex" || "medium";
        
        const route = routeTask(
          {
            complexity,
            description: taskToResume.description,
            fallbackChainPosition: 0,
            claudeBudgetPercent: 0,
          },
          config,
        );
        
        // Create the appropriate adapter based on routing
        const apiKeyEnv = config.providers.alibaba.api_key_env;
        const apiKey = process.env[apiKeyEnv];
        if (!apiKey) {
          console.error(`Resuming requires ${apiKeyEnv} env var.`);
          process.exit(1);
        }
        
        const baseAdapter = createAlibabaAdapter({
          name: "qwen-resume",
          model: model,
          apiKey,
          baseUrl: config.providers.alibaba.base_url,
        });
        
        // Set up retry mechanism with fallback chain
        let fallbackChainPosition = 0;
        if (model) {
          const fallbackChain = config.models.fallback_chain;
          const position = fallbackChain.findIndex(
            (tier) => tier.model === model,
          );
          if (position !== -1) {
            fallbackChainPosition = position;
          }
        }
        
        const adapter = withRetry(baseAdapter, {
          fallbackChainPosition,
          config,
          apiKey,
          baseUrl: config.providers.alibaba.base_url,
        });
        
        // Set up tools
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
        
        // Create the query engine port
        const port = createQueryEnginePort({
          config: engineConfig,
          adapter,
          systemPrompt: `You are resuming a coding task in the repository at ${repoPath}. Continue where you left off.`,
          tools: toolDefinitions,
          sessionStore,
          toolHandlers,
          permissionRules: DEFAULT_PERMISSION_RULES,
        });
        
        // Resume the session
        const resumeStream = port.resume(taskToResume.id);
        
        // Stream events to console
        for await (const event of resumeStream) {
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
            
            // Update status based on end reason
            let taskStatus = 'completed';
            let workItemStatus = 'completed';
            
            if (event.reason === 'completed') {
              taskStatus = 'completed';
              workItemStatus = 'completed';
            } else if (event.reason === 'checkpoint') {
              taskStatus = 'paused';
              workItemStatus = 'paused';
            } else {
              taskStatus = 'failed';
              workItemStatus = 'failed';
            }
            
            await updateTaskStatus(db, taskToResume.id, taskStatus);
            await updateWorkItemStatus(db, workItemId, workItemStatus);
            
            if (event.reason === 'completed') {
              console.log("\n✅ done");
            } else if (event.reason === 'checkpoint') {
              console.log("\n📍 checkpoint saved");
            } else {
              console.log(`\n⚠️  ended: ${event.reason}`);
            }
            break;
          }
        }
      } catch (error) {
        console.error('Error resuming work item:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });
}
