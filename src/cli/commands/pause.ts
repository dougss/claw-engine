export function registerPauseCommand(program: import("commander").Command) {
  program
    .command("pause <work-item-id>")
    .description("Pause a running work item")
    .action(async (workItemId: string) => {
      console.log(`[claw pause] Pausing work item: ${workItemId}`);
      console.log("TODO: integrate with scheduler when Task 16 is complete");
      process.exit(0);
    });
}
