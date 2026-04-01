export function registerLogsCommand(program: import("commander").Command) {
  program
    .command("logs [task-id]")
    .description("View logs for a task or the engine")
    .option("--level <level>", "Filter by log level (debug|info|warn|error)")
    .option("--search <term>", "Search logs for a term")
    .action(
      async (
        taskId: string | undefined,
        opts: { level?: string; search?: string },
      ) => {
        if (taskId) {
          console.log(`[claw logs] Fetching logs for task: ${taskId}`);
        } else {
          console.log("[claw logs] Fetching engine logs...");
        }
        if (opts.level) console.log(`  level filter: ${opts.level}`);
        if (opts.search) console.log(`  search: ${opts.search}`);
        console.log(
          "TODO: integrate with log storage when Task 16 is complete",
        );
        process.exit(0);
      },
    );
}
