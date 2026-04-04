export const SLASH_COMMANDS: Record<string, string> = {
  exit: "Exit the chat session",
  status: "Show current session info (model, tokens, complexity)",
  model: "Switch model — /model <name>",
  delegate: "Force claude -p for the next turn",
  pipeline: "Force full pipeline for the next turn",
  clear: "Clear the screen",
  resume: "Resume a previous session — /resume <id>",
  help: "Show available commands",
};

export interface ParsedCommand {
  name: string;
  args: string[];
}

export function parseSlashCommand(input: string): ParsedCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;

  const parts = trimmed.slice(1).split(/\s+/);
  const name = parts[0];
  if (!name || !(name in SLASH_COMMANDS)) return null;

  return { name, args: parts.slice(1) };
}