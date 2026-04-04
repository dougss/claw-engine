import { listSessions, loadSession } from "../chat/session.js";

export function registerSessionsCommand(program: import("commander").Command) {
  program
    .command("sessions")
    .description("List saved chat sessions")
    .action(async () => {
      const sessionIds = await listSessions();
      if (sessionIds.length === 0) {
        console.log("No saved sessions.");
        return;
      }

      console.log(`${sessionIds.length} saved session(s):\n`);
      for (const id of sessionIds) {
        const s = await loadSession(id);
        if (s) {
          const repo = s.repoPath.split("/").pop() ?? s.repoPath;
          const turns = s.turns.length;
          const tokens = s.totalTokens.toLocaleString();
          const firstPrompt = s.turns[0]?.prompt.slice(0, 60) ?? "(empty)";
          console.log(
            `  ${id.slice(0, 8)}  ${repo}  ${turns} turns  ${tokens} tok  "${firstPrompt}"`,
          );
        } else {
          console.log(`  ${id}`);
        }
      }
    });
}
