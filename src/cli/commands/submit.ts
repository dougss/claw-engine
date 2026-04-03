import { loadConfig } from "../../config.js";
import { classifyTask } from "../../core/classifier.js";
import { createScheduler } from "../../core/scheduler.js";
import { workItemDAGSchema, type WorkItemDAG } from "../../core/dag-schema.js";

export function registerSubmitCommand(program: import("commander").Command) {
  program
    .command("submit <description>")
    .description("Submit a new work item to the queue")
    .option("--repos <repos>", "Comma-separated list of repos to target")
    .option("--issue <url>", "GitHub issue URL to associate")
    .option("--dry-run", "Show what would be submitted without executing")
    .action(
      async (
        description: string,
        opts: { repos?: string; issue?: string; dryRun?: boolean },
      ) => {
        const repos = opts.repos ? opts.repos.split(",") : [];
        if (opts.dryRun) {
          console.log(`[dry-run] Would submit: "${description}"`);
          if (repos.length) console.log(`  repos: ${repos.join(", ")}`);
          if (opts.issue) console.log(`  issue: ${opts.issue}`);
          return;
        }

        const config = loadConfig();
        const connStr =
          process.env.CLAW_ENGINE_DATABASE_URL ??
          (() => {
            const pw =
              process.env[config.database.password_env] ?? "claw_engine_local";
            return `postgresql://${config.database.user}:${pw}@${config.database.host}:${config.database.port}/${config.database.database}`;
          })();
        const { getDb } = await import("../../storage/db.js");
        const { createWorkItem } =
          await import("../../storage/repositories/work-items-repo.js");
        const { createTask } = 
          await import("../../storage/repositories/tasks-repo.js");
        const db = getDb({ connectionString: connStr });
        const wi = await createWorkItem(db, {
          title: description,
          description,
          repos,
          source: "cli",
        });

        console.log(`✅ Work item created: ${wi.id}`);
        console.log(`   Title: ${wi.title}`);
        if (repos.length) console.log(`   Repos: ${repos.join(", ")}`);
        console.log(`   Status: ${wi.status}`);

        // Classify the task complexity
        const apiKey = process.env[config.providers.alibaba.api_key_env] ?? "";
        let complexity: "simple" | "medium" | "complex" = "medium";
        if (apiKey) {
          try {
            const classification = await classifyTask(description, {
              apiKey,
              baseUrl: config.providers.alibaba.base_url,
              model: config.models.default,
            });
            complexity = classification.complexity;
          } catch {
            // If classification fails, default to "medium"
            complexity = "medium";
          }
        }

        // Build a simple single-task DAG
        const repo = repos.length > 0 ? repos[0] : "default_repo"; // Use first repo or default
        const workItemId = wi.id;
        
        // Generate a branch name based on the description
        const slug = description.toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 40);
        const timestamp = Date.now().toString(36);
        const branch = `claw/${slug}-${timestamp}`;
        
        // Create a simple DAG with a single task
        const dag: WorkItemDAG = {
          title: description,
          tasks: [
            {
              id: `task-${workItemId}-0`, // Unique task ID
              repo,
              branch,
              description,
              complexity,
              context_filter: [],
              nexus_skills: [],
              mcp_servers: [],
              estimated_tokens: 1000, // Default estimate
            }
          ],
          edges: [] // No dependencies for a single task
        };

        // Create a scheduler and enqueue the DAG
        const scheduler = await createScheduler({
          redis: {
            host: config.redis.host,
            port: config.redis.port,
          },
          workItemId,
          queueSuffix: workItemId,
          onTaskComplete: async (taskId: string) => {
            console.log(`✅ Task completed: ${taskId}`);
          },
          onTaskFailed: async (taskId: string, err: Error) => {
            console.error(`❌ Task failed: ${taskId}`, err.message);
          },
          runTask: async (jobData) => {
            // Placeholder implementation - in the future this will call the orchestration loop
            console.log(`🏃 Running task: ${jobData.description}`);
          }
        });

        await scheduler.enqueueDAG(dag);

        // Create the task in the database
        const task = await createTask(db, {
          workItemId: workItemId,
          repo,
          branch,
          description,
          complexity,
          estimatedTokens: 1000,
          dagNodeId: dag.tasks[0].id,
        });

        console.log(`   Complexity: ${complexity}`);
        console.log(`   Enqueued task: ${task.id}`);
        console.log(`   Branch: ${branch}`);
        console.log(`   DAG nodes: ${dag.tasks.length}`);
        
        await scheduler.close();
      },
    );
}
