export const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  gray: "\x1b[90m",
  bgGray: "\x1b[48;5;236m",
} as const;

export function formatToolUse(name: string, input: unknown): string {
  const inputStr = JSON.stringify(input ?? {});
  const preview =
    inputStr.length > 60 ? inputStr.slice(0, 57) + "..." : inputStr;
  return `${COLORS.dim}  [tool] ${COLORS.cyan}${name}${COLORS.reset}${COLORS.dim}(${preview})${COLORS.reset}`;
}

export function formatTokenSummary(used: number, budget: number): string {
  const pct = Math.round((used / budget) * 100);
  const color = pct > 80 ? COLORS.red : pct > 50 ? COLORS.yellow : COLORS.green;
  return `${COLORS.dim}  tokens: ${color}${used.toLocaleString()}${COLORS.reset}${COLORS.dim} / ${budget.toLocaleString()} (${pct}%)${COLORS.reset}`;
}

export function formatPhaseStart(phase: string, attempt: number): string {
  return `\n${COLORS.bold}${COLORS.cyan}[pipeline]${COLORS.reset} ${COLORS.bold}▶ ${phase.toUpperCase()}${COLORS.reset}${attempt > 1 ? ` ${COLORS.dim}(attempt ${attempt})${COLORS.reset}` : ""}`;
}

export function formatPhaseEnd(
  phase: string,
  success: boolean,
  durationMs: number,
): string {
  const icon = success ? `${COLORS.green}✓` : `${COLORS.red}✗`;
  return `${COLORS.bold}${COLORS.cyan}[pipeline]${COLORS.reset} ${icon} ${phase.toUpperCase()}${COLORS.reset} ${COLORS.dim}(${durationMs}ms)${COLORS.reset}`;
}

export function formatStatusLine(info: {
  model: string;
  tokens: number;
  complexity: string;
  sessionId: string;
  turn: number;
}): string {
  return [
    `${COLORS.bold}Session:${COLORS.reset} ${COLORS.dim}${info.sessionId.slice(0, 8)}${COLORS.reset}`,
    `${COLORS.bold}Model:${COLORS.reset} ${COLORS.cyan}${info.model}${COLORS.reset}`,
    `${COLORS.bold}Complexity:${COLORS.reset} ${info.complexity}`,
    `${COLORS.bold}Turn:${COLORS.reset} ${info.turn}`,
    `${COLORS.bold}Tokens:${COLORS.reset} ${info.tokens.toLocaleString()}`,
  ].join("  |  ");
}

export function formatPrompt(): string {
  return `${COLORS.bold}${COLORS.cyan}claw >${COLORS.reset} `;
}

export function formatWelcome(
  repoPath: string,
  model: string,
  complexity: string,
): string {
  const repo = repoPath.split("/").pop() ?? repoPath;
  return [
    `${COLORS.bold}Claw Engine${COLORS.reset} — interactive chat`,
    `${COLORS.dim}repo: ${repo}  model: ${model}  complexity: ${complexity}${COLORS.reset}`,
    `${COLORS.dim}Type /help for commands, Ctrl+C to exit${COLORS.reset}`,
    "",
  ].join("\n");
}

export function formatTurnEnd(tokensUsed: number, endReason: string): string {
  const icon =
    endReason === "completed" ? `${COLORS.green}✓` : `${COLORS.yellow}⚠`;
  return `\n${icon} ${endReason}${COLORS.reset} ${COLORS.dim}(${tokensUsed.toLocaleString()} tokens)${COLORS.reset}\n`;
}