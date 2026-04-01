import { resolve, basename } from "node:path";
import { loadConfig } from "../../config.js";
import { routeTask } from "../../core/router.js";
import { runClaudePipe } from "../../integrations/claude-p/claude-pipe.js";
import { getDb } from "../../storage/db.js";
import {
  createWorkItem,
  updateWorkItemStatus,
} from "../../storage/repositories/work-items-repo.js";
import {
  createTask,
  updateTaskStatus,
} from "../../storage/repositories/tasks-repo.js";
import { createAlibabaAdapter } from "../../harness/model-adapters/alibaba-adapter.js";
import { withRetry } from "../../harness/model-adapters/with-retry.js";
import { createQueryEnginePort } from "../../harness/query-engine-port.js";
import {
  createQueryEngineConfig,
  TOOL_PROFILE,
} from "../../harness/query-engine-config.js";
import { DEFAULT_PERMISSION_RULES } from "../../harness/permissions.js";
import { createProductionSessionStore } from "../../core/session-manager.js";
import type { ToolHandler } from "../../harness/tools/tool-types.js";
import { readFileTool } from "../../harness/tools/builtins/read-file.js";
import { writeFileTool } from "../../harness/tools/builtins/write-file.js";
import { editFileTool } from "../../harness/tools/builtins/edit-file.js";
import { bashTool } from "../../harness/tools/builtins/bash.js";
import { globTool } from "../../harness/tools/builtins/glob-tool.js";
import { grepTool } from "../../harness/tools/builtins/grep-tool.js";

export function registerRunCommand(program: import("commander").Command) {
  program
    .command("run <repo> <prompt>")
    .description("Run a single task directly in a repo")
    .option("--model <model>", "Model to use (overrides router)")
    .option("--delegate", "Force delegate mode (claude -p)")
    .option("--dry-run", "Show plan without executing")
    .option("--max-turns <n>", "Maximum agent turns", parseInt)
    .option("--no-resume", "Disable auto-resume on checkpoint")
    .option("--resume <sessionId>", "Resume a previous session by ID")
    .action(
      async (
        repo: string,
        prompt: string,
        opts: {
          model?: string;
          delegate?: boolean;
          dryRun?: boolean;
          maxTurns?: number;
          resume?: boolean | string;
          noResume?: boolean;
        },
      ) => {
        const repoPath = resolve(repo);

        if (opts.dryRun) {
          console.log(`[dry-run] Would run in ${repoPath}: "${prompt}"`);
          return;
        }

        const config = loadConfig();
        const route = routeTask(
          {
            complexity: "medium",
            description: prompt,
            fallbackChainPosition: 0,
            claudeBudgetPercent: 0,
          },
          config,
        );

        const mode = opts.delegate ? "delegate" : route.mode;

        console.log(
          `routing → ${mode} mode (${opts.delegate ? "forced" : route.reason})`,
        );
        console.log(`path    → ${repoPath}\n`);

        // Register this run in the DB so it appears in the dashboard
        const connStr =
          process.env.CLAW_ENGINE_DATABASE_URL ??
          (() => {
            const pw =
              process.env[config.database.password_env] ?? "claw_engine_local";
            return `postgresql://${config.database.user}:${pw}@${config.database.host}:${config.database.port}/${config.database.database}`;
          })();
        let workItemId: string | null = null;
        let taskId: string | null = null;
        try {
          const db = getDb({ connectionString: connStr });
          const wi = await createWorkItem(db, {
            title: prompt.slice(0, 120),
            description: prompt,
            repos: [basename(repoPath)],
            source: "cli:run",
          });
          workItemId = wi.id;
          const branch = `claw-run-${Date.now()}`;
          const task = await createTask(db, {
            workItemId: wi.id,
            repo: basename(repoPath),
            branch,
            description: prompt,
            complexity: "medium",
            model:
              mode === "delegate"
                ? (opts.model ?? "claude")
                : config.models.default,
          });
          taskId = task.id;
          await updateWorkItemStatus(db, wi.id, "running");
          await updateTaskStatus(db, task.id, "running");
        } catch {
          // DB tracking is best-effort — don't fail the run if DB is unavailable
          console.error(
            "[warn] could not register run in DB (dashboard won't show it)",
          );
        }

        const finalizeDb = async (wiStatus: string, taskStatus: string) => {
          if (!workItemId || !taskId) return;
          try {
            const db = getDb({ connectionString: connStr });
            await updateTaskStatus(db, taskId, taskStatus);
            await updateWorkItemStatus(db, workItemId, wiStatus);
          } catch {
            /* best-effort */
          }
        };

        if (mode === "delegate") {
          const claudeBin = config.providers.anthropic.binary;
          let endReason = "completed";

          try {
            for await (const event of runClaudePipe({
              prompt,
              model: opts.model,
              claudeBin,
              workspacePath: repoPath,
            })) {
              if (event.type === "text_delta") {
                process.stdout.write(event.text);
              } else if (event.type === "tool_use") {
                const input = JSON.stringify(event.input ?? {});
                const preview =
                  input.length > 60 ? input.slice(0, 57) + "..." : input;
                process.stderr.write(`\n[tool] ${event.name}(${preview})\n`);
              } else if (event.type === "token_update") {
                process.stderr.write(
                  `\r[tokens] ${event.used.toLocaleString()} / ${event.budget.toLocaleString()} (${event.percent}%)   `,
                );
              } else if (event.type === "session_end") {
                endReason = event.reason;
                process.stderr.write("\n");
                if (event.reason === "completed") {
                  console.log("\n✅ done");
                } else if (event.reason === "interrupted") {
                  console.log("\n⏹  interrupted");
                } else {
                  console.log(`\n⚠️  ended: ${event.reason}`);
                }
              }
            }
          } catch (err) {
            endReason = "failed";
            console.error("\n❌", (err as Error).message);
          }

          const taskStatus =
            endReason === "completed"
              ? "completed"
              : endReason === "interrupted"
                ? "interrupted"
                : "failed";
          const wiStatus =
            endReason === "completed"
              ? "completed"
              : endReason === "interrupted"
                ? "interrupted"
                : "failed";
          await finalizeDb(wiStatus, taskStatus);
        } else {
          // Engine mode: Qwen/DashScope via OpenAI-compatible API
          const apiKeyEnv = config.providers.alibaba.api_key_env;
          const apiKey = process.env[apiKeyEnv];
          if (!apiKey) {
            await finalizeDb("failed", "failed");
            console.error(`Engine mode requires ${apiKeyEnv} env var.`);
            process.exit(1);
          }

          const builtins: ToolHandler[] = [
            readFileTool,
            writeFileTool,
            editFileTool,
            bashTool,
            globTool,
            grepTool,
          ];
          const toolHandlers = new Map<string, ToolHandler>(
            builtins.map((t) => [t.name, t]),
          );
          const toolDefinitions = builtins.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          }));

          const baseAdapter = createAlibabaAdapter({
            name: "qwen-cli",
            model: opts.model ?? config.models.default,
            apiKey,
            baseUrl: config.providers.alibaba.base_url,
          });
          const adapter = withRetry(baseAdapter);

          const sessionStore = await createProductionSessionStore(connStr);

          const sessionId = taskId ?? `session-${Date.now()}`;
          const engineConfig = createQueryEngineConfig({
            maxTurns: opts.maxTurns ?? 200,
            maxTokens: adapter.maxContext,
            workspacePath: repoPath,
            sessionId,
            toolProfile: TOOL_PROFILE.full,
          });

          const systemPrompt = [
            `You are an expert software engineer working in the repository at ${repoPath}.`,
            "Use the available tools to read, write, and modify files to complete the task.",
            "Always read files before modifying them. Make minimal, targeted changes.",
          ].join("\n");

          const port = createQueryEnginePort({
            config: engineConfig,
            adapter,
            systemPrompt,
            tools: toolDefinitions,
            sessionStore,
            toolHandlers,
            permissionRules: DEFAULT_PERMISSION_RULES,
          });

          const autoResume = opts.noResume !== true;
          const MAX_RESUMES = 5;
          let resumeCount = 0;
          let endReason = "completed";

          const manualResumeId =
            typeof opts.resume === "string" ? opts.resume : null;

          try {
            const stream = manualResumeId
              ? port.resume(manualResumeId)
              : port.run(prompt);

            for await (const event of stream) {
              if (event.type === "text_delta") {
                process.stdout.write(event.text);
              } else if (event.type === "tool_use") {
                const input = JSON.stringify(event.input ?? {});
                const preview =
                  input.length > 60 ? input.slice(0, 57) + "..." : input;
                process.stderr.write(`\n[tool] ${event.name}(${preview})\n`);
              } else if (event.type === "token_update") {
                process.stderr.write(
                  `\r[tokens] ${event.used.toLocaleString()} / ${event.budget.toLocaleString()} (${event.percent}%)   `,
                );
              } else if (event.type === "compaction") {
                process.stderr.write(
                  `\n[compaction] ${event.messagesBefore} → ${event.messagesAfter} messages (pass ${event.compactionCount})\n`,
                );
              } else if (event.type === "api_retry") {
                process.stderr.write(
                  `\n[retry] attempt ${event.attempt}/${event.maxAttempts} — ${event.error} (wait ${event.delayMs}ms)\n`,
                );
              } else if (event.type === "session_end") {
                endReason = event.reason;
                process.stderr.write("\n");

                if (event.reason === "completed") {
                  console.log("\n✅ done");
                } else if (event.reason === "checkpoint") {
                  if (autoResume && resumeCount < MAX_RESUMES) {
                    resumeCount++;
                    console.log(
                      `\n⟳ Checkpoint reached. Compacting and resuming... [pass ${resumeCount}/${MAX_RESUMES}]`,
                    );
                    for await (const resumeEvent of port.resume(sessionId)) {
                      if (resumeEvent.type === "text_delta") {
                        process.stdout.write(resumeEvent.text);
                      } else if (resumeEvent.type === "tool_use") {
                        const input = JSON.stringify(resumeEvent.input ?? {});
                        const preview =
                          input.length > 60
                            ? input.slice(0, 57) + "..."
                            : input;
                        process.stderr.write(
                          `\n[tool] ${resumeEvent.name}(${preview})\n`,
                        );
                      } else if (resumeEvent.type === "token_update") {
                        process.stderr.write(
                          `\r[tokens] ${resumeEvent.used.toLocaleString()} / ${resumeEvent.budget.toLocaleString()} (${resumeEvent.percent}%)   `,
                        );
                      } else if (resumeEvent.type === "compaction") {
                        process.stderr.write(
                          `\n[compaction] ${resumeEvent.messagesBefore} → ${resumeEvent.messagesAfter} messages\n`,
                        );
                      } else if (resumeEvent.type === "api_retry") {
                        process.stderr.write(
                          `\n[retry] attempt ${resumeEvent.attempt}/${resumeEvent.maxAttempts} — ${resumeEvent.error} (wait ${resumeEvent.delayMs}ms)\n`,
                        );
                      } else if (resumeEvent.type === "session_end") {
                        endReason = resumeEvent.reason;
                        if (resumeEvent.reason === "completed") {
                          console.log("\n✅ done");
                        } else if (resumeEvent.reason === "checkpoint") {
                          console.log(
                            "\n📍 checkpoint saved — max resumes reached",
                          );
                        } else {
                          console.log(`\n⚠️  ended: ${resumeEvent.reason}`);
                        }
                      }
                    }
                  } else {
                    console.log("\n📍 checkpoint saved");
                  }
                } else {
                  console.log(`\n⚠️  ended: ${event.reason}`);
                }
              }
            }
          } catch (err) {
            endReason = "failed";
            console.error("\n❌", (err as Error).message);
          }

          const taskStatus =
            endReason === "completed"
              ? "completed"
              : endReason === "interrupted"
                ? "interrupted"
                : "failed";
          await finalizeDb(taskStatus, taskStatus);
        }
      },
    );
}
