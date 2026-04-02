import { loadConfig } from "../../config.js";
import { getDb } from "../../storage/db.js";
import {
  getWorkItemById,
  listWorkItems,
} from "../../storage/repositories/work-items-repo.js";
import { getTasksByWorkItemId } from "../../storage/repositories/tasks-repo.js";
import { getTelemetryByTaskId } from "../../storage/repositories/telemetry-repo.js";

export function registerStatusCommand(program: import("commander").Command) {
  program
    .command("status [work-item-id]")
    .description("Show status of work items")
    .option("--json", "Output results as JSON")
    .option("--verbose", "Show all telemetry events (not just the last 3)")
    .action(async (workItemId?: string, options?: { json?: boolean; verbose?: boolean }) => {
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

        if (workItemId) {
          // Show detailed status for specific work item
          const workItem = await getWorkItemById(db, workItemId);

          if (!workItem) {
            if (options?.json) {
              console.log(JSON.stringify({ error: `Work item with ID ${workItemId} not found.` }));
              process.exit(1);
            } else {
              console.error(`Work item with ID ${workItemId} not found.`);
              process.exit(1);
            }
          }

          if (options?.json) {
            // Get associated tasks and telemetry for the JSON output
            const tasks = await getTasksByWorkItemId(db, workItemId);
            const tasksWithTelemetry = await Promise.all(tasks.map(async (task) => {
              const telemetry = await getTelemetryByTaskId(db, task.id);
              const filteredTelemetry = options?.verbose ? telemetry : telemetry.slice(-3);
              return {
                ...task,
                telemetry: filteredTelemetry.map(event => ({
                  ...event,
                  createdAt: new Date(event.createdAt).toISOString()
                }))
              };
            }));

            const detailedWorkItem = {
              ...workItem,
              tasks: tasksWithTelemetry
            };

            console.log(JSON.stringify(detailedWorkItem, null, 2));
          } else {
            console.log(`Work Item: ${workItem.id}`);
            console.log(`Title: ${workItem.title}`);
            console.log(`Description: ${workItem.description || "N/A"}`);
            console.log(`Status: ${workItem.status}`);
            console.log(`Source: ${workItem.source}`);
            console.log(`Created: ${workItem.createdAt}`);
            console.log(`Updated: ${workItem.updatedAt}`);
            console.log(`DAG: ${JSON.stringify(workItem.dag, null, 2)}`);
            console.log("");

            // Get associated tasks
            const tasks = await getTasksByWorkItemId(db, workItemId);
            if (tasks.length > 0) {
              console.log("Associated Tasks:");
              for (const task of tasks) {
                console.log(`  - ID: ${task.id}`);
                console.log(`    Repo: ${task.repo}`);
                console.log(`    Branch: ${task.branch}`);
                console.log(`    Description: ${task.description}`);
                console.log(`    Complexity: ${task.complexity}`);
                console.log(`    Status: ${task.status}`);
                console.log(`    Model: ${task.model || "N/A"}`);
                console.log(`    Tokens Used: ${task.tokensUsed || 0}`);

                // Get telemetry for this task
                const telemetry = await getTelemetryByTaskId(db, task.id);
                if (telemetry.length > 0) {
                  console.log(`    Telemetry Events: ${telemetry.length}`);
                  // Show events based on verbose flag
                  const eventsToShow = options?.verbose ? telemetry : telemetry.slice(-3);
                  for (const event of eventsToShow) {
                    console.log(
                      `      - ${event.eventType} (${new Date(event.createdAt).toLocaleString()})`,
                    );
                  }
                }
                console.log("");
              }
            } else {
              console.log("No associated tasks found.");
            }
          }
        } else {
          // List all active work items
          const [running, queued, paused] = await Promise.all([
            listWorkItems(db, { status: "running" }),
            listWorkItems(db, { status: "queued" }),
            listWorkItems(db, { status: "paused" }),
          ]);
          const activeItems = [...running, ...queued, ...paused];

          if (options?.json) {
            const result = {
              workItems: activeItems,
              summary: {
                running: running.length,
                queued: queued.length,
                paused: paused.length,
                total: activeItems.length
              }
            };
            
            console.log(JSON.stringify(result, null, 2));
          } else {
            console.log("Active Work Items:");
            console.log("");

            if (activeItems.length === 0) {
              console.log("No active work items found.");
            } else {
              for (const item of activeItems) {
                console.log(`ID: ${item.id}`);
                console.log(`Title: ${item.title}`);
                console.log(`Status: ${item.status}`);
                console.log(`Source: ${item.source}`);
                console.log(`Created: ${item.createdAt}`);
                console.log("");
              }
            }
          }
        }
      } catch (error) {
        console.error(
          "Error fetching status:",
          error instanceof Error ? error.message : String(error),
        );
        process.exit(1);
      }
    });
}
