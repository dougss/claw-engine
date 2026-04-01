export function registerStatusCommand(program: import("commander").Command) {
  program
    .command("status [work-item-id]")
    .description("Show status of work items")
    .action(async (workItemId?: string) => {
      if (workItemId) {
        console.log(
          `[claw status] Fetching status for work item: ${workItemId}`,
        );
      } else {
        console.log("[claw status] Listing all work items...");
      }
      console.log("TODO: integrate with DB when Task 16 is complete");
      process.exit(0);
    });
}
