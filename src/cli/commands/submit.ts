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
        console.log(`[claw submit] Queuing work item: "${description}"`);
        if (repos.length) console.log(`  repos: ${repos.join(", ")}`);
        console.log(
          "TODO: integrate with work item queue when Task 16 is complete",
        );
        process.exit(0);
      },
    );
}
