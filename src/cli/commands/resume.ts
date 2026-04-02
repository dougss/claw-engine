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
import { runClaudePipe } from "../../integrations/claude-p/claude-pipe.js";

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

        // Recover workspacePath from the saved checkpoint config
        const checkpointData = await getTaskCheckpointData(db, taskToResume.id);
        const savedWorkspacePath = (
          checkpointData?.config as Record<string, unknown> | null
        )?.workspacePath as string | undefined;
        const repoPath = savedWorkspacePath ?? process.cwd();

        // Run claude delegate pipe with resume option
        const delegateEvents = runClaudePipe({
          prompt: taskToResume.description,
          model: taskToResume.model || undefined,
          claudeBin: config.providers.anthropic.binary,
          workspacePath: repoPath,
          resumeId: taskToResume.id,
        });

        let endReason = "completed";

        try {
          for await (const event of delegateEvents) {
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
            } else if (event.type === "session_end") {
              endReason = event.reason;
              process.stderr.write("\n");
              
              if (event.reason === "completed") {
                console.log("\n✅ done");
              } else if (event.reason === "interrupted") {
                console.log("\n⏹  interrupted");
              } else {
                console.log(`\n⚠️  ended: ${event.reason}`);
              }
            }
          }
        } catch (err) {
          endReason = "failed";
          console.error("\n❌", (err as Error).message);
        }

        // Update task and work item status based on end reason
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
        
        await updateTaskStatus(db, taskToResume.id, taskStatus);
        await updateWorkItemStatus(db, workItemId, wiStatus);
      } catch (error) {
        console.error(
          "Error resuming work item:",
          error instanceof Error ? error.message : String(error),
        );
        process.exit(1);
      }
    });
}
