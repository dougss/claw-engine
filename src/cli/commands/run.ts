export function registerRunCommand(program: import("commander").Command) {
  program
    .command("run <repo> <prompt>")
    .description("Run a single task directly in a repo")
    .option("--model <model>", "Model to use")
    .option("--record", "Record session to JSONL")
    .option("--dry-run", "Show plan without executing")
    .action(
      async (
        repo: string,
        prompt: string,
        opts: { model?: string; record?: boolean; dryRun?: boolean },
      ) => {
        if (opts.dryRun) {
          console.log(`[dry-run] Would run: "${prompt}" in ${repo}`);
          return;
        }
        console.log(`[claw run] Submitting task to ${repo}...`);
        console.log("TODO: integrate with scheduler when Task 16 is complete");
        process.exit(0);
      },
    );
}
