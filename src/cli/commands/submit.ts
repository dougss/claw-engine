import { Queue } from "bullmq";
import { loadConfig } from "../../config.js";
import { classifyTask } from "../../core/classifier.js";
import type { TaskJobData } from "../../core/scheduler.js";

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

        // TODO(FR-030): call the decomposer here to break the description into a
        // multi-task WorkItemDAG. For now we build a trivial single-task DAG
        // (FR-032) — one task, no edges.
        const repo = repos.length > 0 ? repos[0]! : process.cwd();
        const workItemId = wi.id;

        // Generate a branch name based on the description
        const slug = description
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 40);
        const timestamp = Date.now().toString(36);
        const branch = `claw/${slug}-${timestamp}`;

        // Create the task in DB first so we have the real UUID for the job payload
        const task = await createTask(db, {
          workItemId,
          repo,
          branch,
          description,
          complexity,
          estimatedTokens: 1000,
          dagNodeId: `task-${workItemId}-0`,
        });

        // Determine provider queue: complex → anthropic, else alibaba
        const provider = complexity === "complex" ? "anthropic" : "alibaba";
        const queueName = `claw:${provider}`;

        // Enqueue directly — no workers created here (daemon owns the workers)
        const queue = new Queue<TaskJobData>(queueName, {
          connection: { host: config.redis.host, port: config.redis.port },
        });

        const jobData: TaskJobData = {
          taskId: task.id,
          dagNodeId: task.dagNodeId,
          repo,
          branch,
          description,
          complexity,
          estimatedTokens: 1000,
          workItemId,
          dependsOn: [],
          provider,
        };

        await queue.add(task.dagNodeId, jobData, {
          jobId: `${workItemId}-${task.id}`,
        });
        await queue.close();

        console.log(`   Complexity: ${complexity}`);
        console.log(`   Enqueued task: ${task.id}`);
        console.log(`   Queue: ${queueName}`);
        console.log(`   Branch: ${branch}`);
      },
    );
}
