export function registerCleanupCommand(program: import("commander").Command) {
  program
    .command("cleanup")
    .description("Clean up worktrees and old telemetry data")
    .option("--dry-run", "Show what would be cleaned without deleting")
    .action(async (opts: { dryRun?: boolean }) => {
      if (opts.dryRun) {
        console.log(
          "[dry-run] Would clean up orphan worktrees and old telemetry",
        );
        return;
      }
      console.log("[claw cleanup] Running cleanup...");
      console.log(
        "TODO: integrate with cleanup service when Task 16 is complete",
      );
      process.exit(0);
    });
}
