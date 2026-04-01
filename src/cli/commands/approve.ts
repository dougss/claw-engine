export function registerApproveCommand(program: import("commander").Command) {
  program
    .command("approve <work-item-id>")
    .description("Approve a work item pending human review")
    .action(async (workItemId: string) => {
      console.log(`[claw approve] Approving work item: ${workItemId}`);
      console.log(
        "TODO: integrate with approval flow when Task 16 is complete",
      );
      process.exit(0);
    });
}
