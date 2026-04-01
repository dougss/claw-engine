export function registerResumeCommand(program: import("commander").Command) {
  program
    .command("resume <work-item-id>")
    .description("Resume a paused work item")
    .action(async (workItemId: string) => {
      console.log(`[claw resume] Resuming work item: ${workItemId}`);
      console.log("TODO: integrate with scheduler when Task 16 is complete");
      process.exit(0);
    });
}
