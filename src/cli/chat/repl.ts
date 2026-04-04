import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ClawEngineConfig } from "../../config-schema.js";
import type { HarnessEvent } from "../../harness/events.js";
import { runOpencodePipe } from "../../integrations/opencode/opencode-pipe.js";
import { runClaudePipe } from "../../integrations/claude-p/claude-pipe.js";
import { classifyTask } from "../../core/classifier.js";
import { routeTask } from "../../core/router.js";
import { createSession, addTurn, saveSession, loadSession } from "./session.js";
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
  let defaultModel = config.providers.opencode.default_model || "";

  // Session state
  const session = createSession({
    repoPath,
    complexity: defaultComplexity,
    provider: defaultProvider,
    model: defaultModel,
  });

  const rl = readline.createInterface({ input: stdin, output: stdout });

  stdout.write(formatWelcome(repoPath, defaultModel, defaultComplexity));

  // Ctrl+C at empty prompt exits the chat
  rl.on("SIGINT", () => {
    stdout.write("\n");
    rl.close();
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
        if (cmd.name === "resume" && cmd.args[0]) {
          try {
            const loaded = await loadSession(cmd.args[0]);
            if (loaded) {
              session.id = loaded.id;
              session.turns = loaded.turns;
              session.totalTokens = loaded.totalTokens;
              session.complexity = loaded.complexity;
              session.provider = loaded.provider;
              session.model = loaded.model;
              session.branch = loaded.branch;
              stdout.write(
                `${COLORS.green}resumed session (${loaded.turns.length} turns, ${loaded.totalTokens.toLocaleString()} tokens)${COLORS.reset}\n`,
              );
            } else {
              stdout.write(`${COLORS.red}session not found${COLORS.reset}\n`);
            }
          } catch (err) {
            stdout.write(
              `${COLORS.red}resume failed: ${err instanceof Error ? err.message : String(err)}${COLORS.reset}\n`,
            );
          }
          continue;
        } else if (cmd.name === "resume") {
          stdout.write(
            `${COLORS.dim}usage: /resume <session-id>${COLORS.reset}\n`,
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
          const __dirname = fileURLToPath(new URL(".", import.meta.url));
          const mcpConfigPath = join(__dirname, "../../../config/mcp.json");

          const result = await runPipeline({
            repoPath,
            prompt: trimmed,
            config,
            complexity: session.complexity,
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
    // Save session before closing
    if (session.turns.length > 0) {
      await saveSession(session);
      stdout.write(
        `\n${COLORS.dim}session saved: ${session.id} (${session.turns.length} turns, ${session.totalTokens.toLocaleString()} tokens)${COLORS.reset}\n`,
      );
    }
    rl.close();
  }
}
