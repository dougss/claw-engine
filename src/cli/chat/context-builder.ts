import type { ChatSession } from "./session.js";

const MAX_CONTEXT_TURNS = 5;

/**
 * Builds a prompt for follow-up delegate turns. Includes a context preamble
 * summarizing previous turns so the fresh subprocess has conversation history.
 * Returns the raw prompt if this is the first turn (no context needed).
 */
export function buildFollowUpPrompt(
  session: ChatSession,
  currentPrompt: string,
): string {
  if (session.turns.length === 0) return currentPrompt;

  const recentTurns = session.turns.slice(-MAX_CONTEXT_TURNS);
  const context = recentTurns
    .map((t, i) => `  ${i + 1}. "${t.prompt.slice(0, 120)}" — ${t.endReason}`)
    .join("\n");

  return [
    "CONTEXT — This is a follow-up in an ongoing interactive session.",
    `Original task: "${session.turns[0]!.prompt.slice(0, 200)}"`,
    `Previous turns (most recent ${recentTurns.length}):`,
    context,
    "",
    "CURRENT REQUEST:",
    currentPrompt,
  ].join("\n");
}