import { loadConfig } from "../../config.js";
import { getDb } from "../../storage/db.js";
import { getWorkItemById, updateWorkItemStatus } from "../../storage/repositories/work-items-repo.js";
import { getTasksByWorkItemId, updateTaskStatus } from "../../storage/repositories/tasks-repo.js";

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
        
        // Check if work item exists
        const workItem = await getWorkItemById(db, workItemId);
        if (!workItem) {
          console.error(`Work item with ID ${workItemId} not found.`);
          process.exit(1);
        }
        
        // Update work item status to cancelled
        await updateWorkItemStatus(db, workItemId, 'cancelled');
        console.log(`Work item ${workItemId} status updated to cancelled.`);
        
        // Get associated tasks and update their status to cancelled
        const tasks = await getTasksByWorkItemId(db, workItemId);
        if (tasks.length > 0) {
          for (const task of tasks) {
            await updateTaskStatus(db, task.id, 'cancelled');
            console.log(`Task ${task.id} status updated to cancelled.`);
          }
          console.log(`${tasks.length} associated tasks cancelled.`);
        } else {
          console.log('No associated tasks found.');
        }
        
        console.log(`Cancellation completed for work item ${workItemId}.`);
      } catch (error) {
        console.error('Error cancelling work item:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });
}
