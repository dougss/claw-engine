export function registerRouterStatsCommand(
  program: import("commander").Command,
) {
  program
    .command("router-stats")
    .description("Show routing statistics (engine vs delegate decisions)")
    .action(async () => {
      console.log("[claw router-stats] Fetching router statistics...");
      console.log("TODO: integrate with router DB when Task 16 is complete");
      process.exit(0);
    });
}
