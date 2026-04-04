import { resolve } from "node:path";
import { loadConfig } from "../../config.js";

export function registerChatCommand(program: import("commander").Command) {
  program
    .command("chat")
    .description("Start an interactive chat session (default when no args)")
    .option("--repo <path>", "Target repo (default: cwd)")
    .option("--no-commit", "Skip automatic git commit of changes")
    .option("--pipeline", "Enable pipeline on first turn (plan→execute→review)")
    .option("--resume <id>", "Resume a previous session")
    .action(
      async (opts: {
        repo?: string;
        commit?: boolean;
        pipeline?: boolean;
        resume?: string;
      }) => {
        const { startRepl } = await import("../chat/repl.js");
        const config = loadConfig();
        const repoPath = resolve(opts.repo ?? ".");
        await startRepl({
          repoPath,
          config,
          noCommit: opts.commit === false,
          noPipeline: opts.pipeline !== true,
          resumeId: opts.resume,
        });
      },
    );
}
