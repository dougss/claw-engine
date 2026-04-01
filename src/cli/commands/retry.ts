export function registerRetryCommand(program: import("commander").Command) {
  program
    .command("retry <task-id>")
    .description("Retry a failed task")
    .action(async (taskId: string) => {
      console.log(`[claw retry] Retrying task: ${taskId}`);
      console.log("TODO: integrate with scheduler when Task 16 is complete");
      process.exit(0);
    });
}
