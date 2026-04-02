import { loadConfig } from "../../config.js";
import { getDb } from "../../storage/db.js";
import {
  getWorkItemById,
  updateWorkItemStatus,
} from "../../storage/repositories/work-items-repo.js";
import {
  getTasksByWorkItemId,
  updateTaskStatus,
} from "../../storage/repositories/tasks-repo.js";

export function registerCancelCommand(program: import("commander").Command) {
  program
    .command("cancel <work-item-id>")
    .description("Cancel a work item")
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

        const TERMINAL = ["completed", "failed", "cancelled"];
        if (TERMINAL.includes(workItem.status)) {
          console.log(
            `Work item ${workItemId} is already in terminal status: ${workItem.status}`,
          );
          process.exit(0);
        }

        await updateWorkItemStatus(db, workItemId, "cancelled");

        const tasks = await getTasksByWorkItemId(db, workItemId);
        let cancelledCount = 0;
        for (const task of tasks) {
          if (!TERMINAL.includes(task.status)) {
            await updateTaskStatus(db, task.id, "cancelled");
            cancelledCount++;
          }
        }

        console.log(
          `✅ Cancelled work item ${workItemId} (${cancelledCount} task${cancelledCount !== 1 ? "s" : ""} cancelled).`,
        );
      } catch (error) {
        console.error(
          "Error cancelling work item:",
          error instanceof Error ? error.message : String(error),
        );
        process.exit(1);
      }
    });
}
