export function registerCancelCommand(program: import("commander").Command) {
  program
    .command("cancel <work-item-id>")
    .description("Cancel a work item")
    .action(async (workItemId: string) => {
      console.log(`[claw cancel] Cancelling work item: ${workItemId}`);
      console.log("TODO: integrate with scheduler when Task 16 is complete");
      process.exit(0);
    });
}
