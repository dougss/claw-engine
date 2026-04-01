export function registerSessionsCommand(program: import("commander").Command) {
  program
    .command("sessions")
    .description("List active sessions")
    .action(async () => {
      console.log("[claw sessions] Listing active sessions...");
      console.log(
        "TODO: integrate with session manager when Task 16 is complete",
      );
      process.exit(0);
    });
}
