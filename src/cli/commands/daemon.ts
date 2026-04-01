export function registerDaemonCommand(program: import("commander").Command) {
  program
    .command("daemon <action>")
    .description("Manage the claw engine daemon (start|stop|status)")
    .action(async (action: string) => {
      const valid = ["start", "stop", "status"];
      if (!valid.includes(action)) {
        console.error(
          `Unknown daemon action: ${action}. Use: ${valid.join("|")}`,
        );
        process.exit(1);
      }
      console.log(`[claw daemon] ${action}...`);
      console.log(
        "TODO: integrate with daemon manager when Task 16 is complete",
      );
      process.exit(0);
    });
}
