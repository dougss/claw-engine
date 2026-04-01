import { loadConfig } from "../../config.js";

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
            const pw = process.env[config.database.password_env] ?? "";
            return `postgresql://${config.database.user}:${pw}@${config.database.host}:${config.database.port}/${config.database.database}`;
          })();
        const { getDb } = await import("../../storage/db.js");
        const { createWorkItem } =
          await import("../../storage/repositories/work-items-repo.js");
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
      },
    );
}
