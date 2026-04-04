# Interactive Chat CLI — Implementation Plan

**Goal:** Add an interactive REPL chat mode to `claw` that wraps existing delegate pipes (opencode/claude -p) in a multi-turn conversation loop with formatted terminal output.
**Architecture:** Readline-based REPL loop → slash command dispatcher → delegate spawner (reuses existing pipes) → terminal renderer (ANSI). First turn runs pipeline, follow-ups spawn delegate directly with context preamble.
**Tech Stack:** Node.js readline/promises, ANSI escapes, existing opencode-pipe/claude-pipe/pipeline, existing DB repos for session tracking.
**Spec:** specs/interactive-chat/spec.md
**Plan:** specs/interactive-chat/plan.md

**REQUIRED SUB-SKILL:** nexus:subagent-driven-development (recommended for parallel execution) OR nexus:executing-plans (for sequential execution)

---

## File Structure

### New files

| File                                          | Purpose                                                         |
| --------------------------------------------- | --------------------------------------------------------------- |
| `src/cli/chat/repl.ts`                        | Main REPL loop — readline, turn dispatch, Ctrl+C handling       |
| `src/cli/chat/renderer.ts`                    | Terminal output formatting — markdown, tool calls, status lines |
| `src/cli/chat/commands.ts`                    | Slash command registry and handlers                             |
| `src/cli/chat/session.ts`                     | Chat session state — turns, tokens, branch, model, flags        |
| `src/cli/chat/context-builder.ts`             | Build context preamble for follow-up delegate turns             |
| `src/cli/commands/chat.ts`                    | Commander registration for `claw chat` (also default command)   |
| `tests/unit/cli/chat/renderer.test.ts`        | Renderer unit tests                                             |
| `tests/unit/cli/chat/commands.test.ts`        | Slash command unit tests                                        |
| `tests/unit/cli/chat/context-builder.test.ts` | Context preamble unit tests                                     |
| `tests/unit/cli/chat/session.test.ts`         | Session state unit tests                                        |

### Modified files

| File               | Change                                                                   |
| ------------------ | ------------------------------------------------------------------------ |
| `src/cli/index.ts` | Add `registerChatCommand`, update default-command logic (no args → chat) |

---

## Task 1: Session State

Core data structure that tracks the chat session across turns.

**Files:**

- Create: `src/cli/chat/session.ts`
- Test: `tests/unit/cli/chat/session.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/cli/chat/session.test.ts
import { describe, it, expect } from "vitest";
import {
  createSession,
  addTurn,
  getTurnSummary,
  type ChatSession,
} from "../../../../src/cli/chat/session.js";

describe("ChatSession", () => {
  it("creates a session with defaults", () => {
    const s = createSession({
      repoPath: "/tmp/repo",
      complexity: "medium",
      provider: "opencode",
      model: "qwen3-coder-plus",
    });
    expect(s.id).toBeTruthy();
    expect(s.turns).toEqual([]);
    expect(s.totalTokens).toBe(0);
    expect(s.branch).toBeNull();
    expect(s.flags.forcePipeline).toBe(false);
    expect(s.flags.forceDelegate).toBe(false);
  });

  it("adds a turn and accumulates tokens", () => {
    const s = createSession({
      repoPath: "/tmp/repo",
      complexity: "simple",
      provider: "opencode",
      model: "m",
    });
    addTurn(s, { prompt: "fix bug", tokensUsed: 500, endReason: "completed" });
    expect(s.turns).toHaveLength(1);
    expect(s.totalTokens).toBe(500);
    addTurn(s, {
      prompt: "also this",
      tokensUsed: 300,
      endReason: "completed",
    });
    expect(s.totalTokens).toBe(800);
  });

  it("getTurnSummary produces compact summary", () => {
    const s = createSession({
      repoPath: "/tmp/repo",
      complexity: "medium",
      provider: "opencode",
      model: "m",
    });
    addTurn(s, {
      prompt: "implement auth",
      tokensUsed: 1000,
      endReason: "completed",
    });
    addTurn(s, {
      prompt: "add tests",
      tokensUsed: 500,
      endReason: "completed",
    });
    const summary = getTurnSummary(s);
    expect(summary).toContain("implement auth");
    expect(summary).toContain("add tests");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
      Run: `npx vitest run tests/unit/cli/chat/session.test.ts`
      Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// src/cli/chat/session.ts
import { randomUUID } from "node:crypto";

export interface ChatTurn {
  prompt: string;
  tokensUsed: number;
  endReason: string;
  timestamp: number;
}

export interface ChatSession {
  id: string;
  repoPath: string;
  complexity: "simple" | "medium" | "complex";
  provider: string;
  model: string;
  branch: string | null;
  turns: ChatTurn[];
  totalTokens: number;
  flags: {
    forcePipeline: boolean;
    forceDelegate: boolean;
  };
}

export function createSession(opts: {
  repoPath: string;
  complexity: "simple" | "medium" | "complex";
  provider: string;
  model: string;
}): ChatSession {
  return {
    id: randomUUID(),
    repoPath: opts.repoPath,
    complexity: opts.complexity,
    provider: opts.provider,
    model: opts.model,
    branch: null,
    turns: [],
    totalTokens: 0,
    flags: { forcePipeline: false, forceDelegate: false },
  };
}

export function addTurn(
  session: ChatSession,
  turn: { prompt: string; tokensUsed: number; endReason: string },
): void {
  session.turns.push({ ...turn, timestamp: Date.now() });
  session.totalTokens += turn.tokensUsed;
}

export function getTurnSummary(session: ChatSession): string {
  return session.turns
    .map(
      (t, i) =>
        `Turn ${i + 1}: "${t.prompt.slice(0, 80)}" (${t.endReason}, ${t.tokensUsed} tokens)`,
    )
    .join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**
      Expected: PASS

- [ ] **Step 5: Commit**
      `git add src/cli/chat/session.ts tests/unit/cli/chat/session.test.ts && git commit -m "feat(chat): add ChatSession state management"`

---

## Task 2: Terminal Renderer

Formats HarnessEvents into styled terminal output with ANSI colors.

**Files:**

- Create: `src/cli/chat/renderer.ts`
- Test: `tests/unit/cli/chat/renderer.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/cli/chat/renderer.test.ts
import { describe, it, expect } from "vitest";
import {
  formatToolUse,
  formatTokenSummary,
  formatPhaseStart,
  formatPhaseEnd,
  formatStatusLine,
  COLORS,
} from "../../../../src/cli/chat/renderer.js";

describe("renderer", () => {
  it("formatToolUse shows tool name and truncated input", () => {
    const line = formatToolUse("Read", {
      file_path: "/very/long/path/to/file.ts",
    });
    expect(line).toContain("Read");
    expect(line).toContain("file_path");
  });

  it("formatTokenSummary shows used tokens", () => {
    const line = formatTokenSummary(15000, 200000);
    expect(line).toContain("15,000");
  });

  it("formatPhaseStart shows phase name", () => {
    const line = formatPhaseStart("execute", 1);
    expect(line).toContain("EXECUTE");
  });

  it("formatPhaseEnd shows success/fail icon", () => {
    const pass = formatPhaseEnd("validate", true, 1200);
    expect(pass).toContain("VALIDATE");
    const fail = formatPhaseEnd("validate", false, 500);
    expect(fail).toContain("VALIDATE");
  });

  it("formatStatusLine shows model and tokens", () => {
    const line = formatStatusLine({
      model: "qwen3-coder-plus",
      tokens: 5000,
      complexity: "medium",
      sessionId: "abc-123",
      turn: 3,
    });
    expect(line).toContain("qwen3-coder-plus");
    expect(line).toContain("5,000");
    expect(line).toContain("medium");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
      Run: `npx vitest run tests/unit/cli/chat/renderer.test.ts`
      Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// src/cli/chat/renderer.ts

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
```

- [ ] **Step 4: Run test to verify it passes**
      Expected: PASS

- [ ] **Step 5: Commit**
      `git add src/cli/chat/renderer.ts tests/unit/cli/chat/renderer.test.ts && git commit -m "feat(chat): add terminal renderer with ANSI formatting"`

---

## Task 3: Slash Command Registry

Parses and dispatches slash commands.

**Files:**

- Create: `src/cli/chat/commands.ts`
- Test: `tests/unit/cli/chat/commands.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/cli/chat/commands.test.ts
import { describe, it, expect } from "vitest";
import {
  parseSlashCommand,
  SLASH_COMMANDS,
} from "../../../../src/cli/chat/commands.js";

describe("slash commands", () => {
  it("parses /exit", () => {
    const cmd = parseSlashCommand("/exit");
    expect(cmd).toEqual({ name: "exit", args: [] });
  });

  it("parses /model with argument", () => {
    const cmd = parseSlashCommand("/model qwen3-coder-plus");
    expect(cmd).toEqual({ name: "model", args: ["qwen3-coder-plus"] });
  });

  it("parses /resume with id", () => {
    const cmd = parseSlashCommand("/resume abc-123-def");
    expect(cmd).toEqual({ name: "resume", args: ["abc-123-def"] });
  });

  it("returns null for unknown command", () => {
    const cmd = parseSlashCommand("/unknown");
    expect(cmd).toBeNull();
  });

  it("returns null for non-slash input", () => {
    const cmd = parseSlashCommand("fix the bug");
    expect(cmd).toBeNull();
  });

  it("parses /pipeline with no args", () => {
    const cmd = parseSlashCommand("/pipeline");
    expect(cmd).toEqual({ name: "pipeline", args: [] });
  });

  it("parses /delegate with no args", () => {
    const cmd = parseSlashCommand("/delegate");
    expect(cmd).toEqual({ name: "delegate", args: [] });
  });

  it("SLASH_COMMANDS has help text for all commands", () => {
    const names = Object.keys(SLASH_COMMANDS);
    expect(names).toContain("exit");
    expect(names).toContain("status");
    expect(names).toContain("model");
    expect(names).toContain("delegate");
    expect(names).toContain("pipeline");
    expect(names).toContain("clear");
    expect(names).toContain("resume");
    expect(names).toContain("help");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
      Run: `npx vitest run tests/unit/cli/chat/commands.test.ts`
      Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// src/cli/chat/commands.ts

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
```

- [ ] **Step 4: Run test to verify it passes**
      Expected: PASS

- [ ] **Step 5: Commit**
      `git add src/cli/chat/commands.ts tests/unit/cli/chat/commands.test.ts && git commit -m "feat(chat): add slash command registry"`

---

## Task 4: Context Builder

Builds the context preamble for follow-up turns so the fresh delegate subprocess has conversation context.

**Files:**

- Create: `src/cli/chat/context-builder.ts`
- Test: `tests/unit/cli/chat/context-builder.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/cli/chat/context-builder.test.ts
import { describe, it, expect } from "vitest";
import { buildFollowUpPrompt } from "../../../../src/cli/chat/context-builder.js";
import type { ChatSession } from "../../../../src/cli/chat/session.js";
import { createSession, addTurn } from "../../../../src/cli/chat/session.js";

describe("context-builder", () => {
  it("returns raw prompt when no previous turns", () => {
    const s = createSession({
      repoPath: "/repo",
      complexity: "medium",
      provider: "opencode",
      model: "m",
    });
    const result = buildFollowUpPrompt(s, "fix the bug");
    expect(result).toBe("fix the bug");
  });

  it("includes previous turn context for follow-ups", () => {
    const s = createSession({
      repoPath: "/repo",
      complexity: "medium",
      provider: "opencode",
      model: "m",
    });
    addTurn(s, {
      prompt: "implement auth system",
      tokensUsed: 5000,
      endReason: "completed",
    });
    const result = buildFollowUpPrompt(s, "now add tests");
    expect(result).toContain("implement auth system");
    expect(result).toContain("now add tests");
    expect(result).toContain("CONTEXT");
  });

  it("limits context to last 5 turns", () => {
    const s = createSession({
      repoPath: "/repo",
      complexity: "medium",
      provider: "opencode",
      model: "m",
    });
    for (let i = 0; i < 8; i++) {
      addTurn(s, {
        prompt: `turn ${i}`,
        tokensUsed: 100,
        endReason: "completed",
      });
    }
    const result = buildFollowUpPrompt(s, "next task");
    // Should not contain turn 0, 1, 2 — only last 5
    expect(result).not.toContain("turn 0");
    expect(result).not.toContain("turn 1");
    expect(result).not.toContain("turn 2");
    expect(result).toContain("turn 3");
    expect(result).toContain("turn 7");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
      Run: `npx vitest run tests/unit/cli/chat/context-builder.test.ts`
      Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// src/cli/chat/context-builder.ts
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
```

- [ ] **Step 4: Run test to verify it passes**
      Expected: PASS

- [ ] **Step 5: Commit**
      `git add src/cli/chat/context-builder.ts tests/unit/cli/chat/context-builder.test.ts && git commit -m "feat(chat): add context builder for follow-up turns"`

---

## Task 5: REPL Loop

The core interactive loop — readline, turn dispatch, event rendering, Ctrl+C handling.

**Files:**

- Create: `src/cli/chat/repl.ts`

- [ ] **Step 1: Write implementation**

```typescript
// src/cli/chat/repl.ts
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { resolve, basename } from "node:path";
import type { ClawEngineConfig } from "../../config-schema.js";
import type { HarnessEvent } from "../../harness/events.js";
import { runOpencodePipe } from "../../integrations/opencode/opencode-pipe.js";
import { runClaudePipe } from "../../integrations/claude-p/claude-pipe.js";
import { classifyTask } from "../../core/classifier.js";
import { routeTask } from "../../core/router.js";
import { createSession, addTurn, type ChatSession } from "./session.js";
import { buildFollowUpPrompt } from "./context-builder.js";
import { parseSlashCommand, SLASH_COMMANDS } from "./commands.js";
import {
  formatToolUse,
  formatTurnEnd,
  formatPhaseStart,
  formatPhaseEnd,
  formatWelcome,
  formatPrompt,
  formatStatusLine,
  COLORS,
} from "./renderer.js";

export interface ReplOptions {
  repoPath: string;
  config: ClawEngineConfig;
  noCommit?: boolean;
  noPipeline?: boolean;
  resumeId?: string;
}

export async function startRepl(opts: ReplOptions): Promise<void> {
  const { repoPath, config } = opts;

  // Classify upfront for routing defaults
  const apiKey = process.env[config.providers.alibaba.api_key_env] ?? "";
  let defaultComplexity: "simple" | "medium" | "complex" = "medium";
  let defaultProvider = "opencode";
  let defaultModel = config.providers.opencode.default_model;

  // Session state
  const session = createSession({
    repoPath,
    complexity: defaultComplexity,
    provider: defaultProvider,
    model: defaultModel,
  });

  const rl = readline.createInterface({ input: stdin, output: stdout });

  stdout.write(formatWelcome(repoPath, defaultModel, defaultComplexity));

  let abortController: AbortController | null = null;

  // Ctrl+C: kill delegate if running, else exit on empty prompt
  rl.on("SIGINT", () => {
    if (abortController) {
      abortController.abort();
      abortController = null;
      stdout.write(`\n${COLORS.yellow}interrupted${COLORS.reset}\n`);
    } else {
      stdout.write("\n");
      rl.close();
    }
  });

  try {
    while (true) {
      const input = await rl.question(formatPrompt()).catch(() => null);
      if (input === null) break; // EOF or closed

      const trimmed = input.trim();
      if (!trimmed) continue;

      // Slash commands
      const cmd = parseSlashCommand(trimmed);
      if (cmd) {
        if (cmd.name === "exit") break;
        if (cmd.name === "help") {
          for (const [name, desc] of Object.entries(SLASH_COMMANDS)) {
            stdout.write(
              `  ${COLORS.cyan}/${name}${COLORS.reset}  ${COLORS.dim}${desc}${COLORS.reset}\n`,
            );
          }
          continue;
        }
        if (cmd.name === "status") {
          stdout.write(
            formatStatusLine({
              model: session.model,
              tokens: session.totalTokens,
              complexity: session.complexity,
              sessionId: session.id,
              turn: session.turns.length,
            }) + "\n",
          );
          continue;
        }
        if (cmd.name === "model" && cmd.args[0]) {
          session.model = cmd.args[0];
          stdout.write(`${COLORS.dim}model → ${cmd.args[0]}${COLORS.reset}\n`);
          continue;
        }
        if (cmd.name === "delegate") {
          session.flags.forceDelegate = true;
          stdout.write(`${COLORS.dim}next turn → claude -p${COLORS.reset}\n`);
          continue;
        }
        if (cmd.name === "pipeline") {
          session.flags.forcePipeline = true;
          stdout.write(
            `${COLORS.dim}next turn → full pipeline${COLORS.reset}\n`,
          );
          continue;
        }
        if (cmd.name === "clear") {
          stdout.write("\x1b[2J\x1b[H");
          continue;
        }
        if (cmd.name === "resume") {
          stdout.write(
            `${COLORS.dim}resume not yet implemented${COLORS.reset}\n`,
          );
          continue;
        }
        continue;
      }

      // Determine if this turn uses pipeline or delegate-only
      const isFirstTurn = session.turns.length === 0;
      const usePipeline =
        session.flags.forcePipeline || (isFirstTurn && !opts.noPipeline);

      // Reset one-shot flags
      session.flags.forcePipeline = false;

      // Classify on first turn
      if (isFirstTurn && apiKey) {
        try {
          const classification = await classifyTask(trimmed, {
            apiKey,
            baseUrl: config.providers.alibaba.base_url,
            model: config.models.default,
          });
          session.complexity = classification.complexity;
          const route = routeTask(
            {
              complexity: classification.complexity,
              description: trimmed,
              fallbackChainPosition: 0,
            },
            config,
          );
          session.provider = route.provider;
          session.model = route.model;
          defaultComplexity = classification.complexity;
          defaultProvider = route.provider;
          defaultModel = route.model;
        } catch {
          // fallback to defaults
        }
      }

      // Override provider if /delegate was used
      const turnProvider = session.flags.forceDelegate
        ? "anthropic"
        : session.provider;
      session.flags.forceDelegate = false;

      let turnTokens = 0;
      let endReason = "completed";

      if (usePipeline) {
        // Pipeline turn — reuse existing runPipeline
        try {
          const { runPipeline } = await import("../../core/pipeline.js");
          const { resolve: resolvePath } = await import("node:path");
          const { fileURLToPath } = await import("node:url");
          const __dirname = fileURLToPath(new URL(".", import.meta.url));
          const mcpConfigPath = resolvePath(
            __dirname,
            "../../../config/mcp.json",
          );

          const result = await runPipeline({
            repoPath,
            prompt: trimmed,
            config,
            claudeBin: config.providers.anthropic.binary,
            opencodeBin: config.providers.opencode.binary,
            mcpConfigPath,
            opencodeModel: session.model,
            maxRetries: config.validation.max_retries,
            maxReviewRetries: 2,
            openPr: false,
            onEvent: (event: HarnessEvent) => {
              if (event.type === "text_delta") {
                stdout.write(event.text);
              } else if (event.type === "tool_use") {
                stdout.write(formatToolUse(event.name, event.input) + "\n");
              } else if (event.type === "phase_start") {
                stdout.write(
                  formatPhaseStart(event.phase, event.attempt) + "\n",
                );
              } else if (event.type === "phase_end") {
                stdout.write(
                  formatPhaseEnd(event.phase, event.success, event.durationMs) +
                    "\n",
                );
              } else if (event.type === "token_update") {
                turnTokens = event.used;
              }
            },
          });
          endReason = result.executeSuccess ? "completed" : "failed";
        } catch (err) {
          endReason = "failed";
          stdout.write(
            `\n${COLORS.red}pipeline error: ${err instanceof Error ? err.message : String(err)}${COLORS.reset}\n`,
          );
        }
      } else {
        // Delegate-only turn
        const prompt = buildFollowUpPrompt(session, trimmed);
        const events =
          turnProvider === "opencode"
            ? runOpencodePipe({
                prompt,
                model: session.model,
                opencodeBin: config.providers.opencode.binary,
                workspacePath: repoPath,
              })
            : runClaudePipe({
                prompt,
                claudeBin: config.providers.anthropic.binary,
                workspacePath: repoPath,
              });

        try {
          for await (const event of events) {
            if (event.type === "text_delta") {
              stdout.write(event.text);
            } else if (event.type === "tool_use") {
              stdout.write(formatToolUse(event.name, event.input) + "\n");
            } else if (event.type === "token_update") {
              turnTokens = event.used;
            } else if (event.type === "session_end") {
              endReason = event.reason;
            }
          }
        } catch (err) {
          endReason = "failed";
          stdout.write(
            `\n${COLORS.red}${err instanceof Error ? err.message : String(err)}${COLORS.reset}\n`,
          );
        }
      }

      stdout.write(formatTurnEnd(turnTokens, endReason));
      addTurn(session, { prompt: trimmed, tokensUsed: turnTokens, endReason });
    }
  } finally {
    rl.close();
    // Print session ID for potential resume
    if (session.turns.length > 0) {
      stdout.write(
        `\n${COLORS.dim}session: ${session.id} (${session.turns.length} turns, ${session.totalTokens.toLocaleString()} tokens)${COLORS.reset}\n`,
      );
    }
  }
}
```

- [ ] **Step 2: Verify typecheck**
      Run: `npx tsc --noEmit`
      Expected: no errors

- [ ] **Step 3: Commit**
      `git add src/cli/chat/repl.ts && git commit -m "feat(chat): add main REPL loop with pipeline/delegate dispatch"`

---

## Task 6: CLI Registration + Default Command

Wire the chat command into Commander and update the default-command logic.

**Files:**

- Create: `src/cli/commands/chat.ts`
- Modify: `src/cli/index.ts`

- [ ] **Step 1: Create chat command registration**

```typescript
// src/cli/commands/chat.ts
import { resolve } from "node:path";
import { loadConfig } from "../../config.js";

export function registerChatCommand(program: import("commander").Command) {
  program
    .command("chat")
    .description("Start an interactive chat session (default when no args)")
    .option("--repo <path>", "Target repo (default: cwd)")
    .option("--no-commit", "Skip automatic git commit of changes")
    .option("--no-pipeline", "Disable pipeline on first turn")
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
          noPipeline: opts.pipeline === false,
          resumeId: opts.resume,
        });
      },
    );
}
```

- [ ] **Step 2: Update index.ts — register chat command, update default logic**

In `src/cli/index.ts`:

- Add `import { registerChatCommand } from "./commands/chat.js";`
- Add `registerChatCommand(program);` after the other registrations
- Update the default-command block: if NO arguments at all, inject `"chat"` instead of `"run"`

```typescript
// Updated default-command logic in index.ts:
const knownCommands = new Set(program.commands.map((c) => c.name()));
const [, , firstArg] = process.argv;

if (!firstArg) {
  // No arguments: enter interactive chat
  process.argv.splice(2, 0, "chat");
} else if (!firstArg.startsWith("-") && !knownCommands.has(firstArg)) {
  // Unknown command: treat as prompt for one-shot run
  process.argv.splice(2, 0, "run");
}
```

- [ ] **Step 3: Verify typecheck**
      Run: `npx tsc --noEmit`
      Expected: no errors

- [ ] **Step 4: Verify all tests pass**
      Run: `npm test`
      Expected: all tests pass

- [ ] **Step 5: Manual smoke test**
      Run: `claw --help` → should list `chat` command
      Run: `cd /tmp && claw` → should show welcome + prompt
      Run: type `/help` → should list commands
      Run: type `/exit` → should exit gracefully

- [ ] **Step 6: Commit**
      `git add src/cli/commands/chat.ts src/cli/index.ts && git commit -m "feat(chat): wire chat command + default to chat on no args"`

---

## Task Summary

| Task      | Component         | Approx LOC   | Dependencies                       |
| --------- | ----------------- | ------------ | ---------------------------------- |
| 1         | Session State     | ~60          | none                               |
| 2         | Terminal Renderer | ~80          | none                               |
| 3         | Slash Commands    | ~35          | none                               |
| 4         | Context Builder   | ~30          | Task 1                             |
| 5         | REPL Loop         | ~200         | Tasks 1-4, existing pipes/pipeline |
| 6         | CLI Registration  | ~50          | Task 5                             |
| **Total** |                   | **~455 LOC** |                                    |

Tasks 1, 2, 3 are independent and can run in parallel.
Task 4 depends on Task 1.
Task 5 depends on Tasks 1-4.
Task 6 depends on Task 5.
