export function registerCostsCommand(program: import("commander").Command) {
  program
    .command("costs")
    .description("Show token usage and cost estimates")
    .option("--days <n>", "Number of days to look back", "7")
    .action(async (opts: { days: string }) => {
      const days = parseInt(opts.days, 10);
      console.log(`[claw costs] Showing costs for the last ${days} day(s)...`);
      console.log("TODO: integrate with telemetry DB when Task 16 is complete");
      process.exit(0);
    });
}
