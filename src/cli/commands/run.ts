import { resolve, basename } from "node:path";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { loadConfig } from "../../config.js";
import { loadProjectContext } from "../../harness/context-builder.js";
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
  updateTaskTokens,
} from "../../storage/repositories/tasks-repo.js";
import { insertTelemetryEvent } from "../../storage/repositories/telemetry-repo.js";
import { createAlibabaAdapter } from "../../harness/model-adapters/alibaba-adapter.js";
import { classifyTask } from "../../core/classifier.js";
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
import { execSync } from "node:child_process";
import { connectNexusMcp } from "../../integrations/nexus/client.js";
import type { ToolDefinition } from "../../types.js";

export function registerRunCommand(program: import("commander").Command) {
  function autoCommit(
    repoPath: string,
    prompt: string,
    noCommit: boolean,
  ): void {
    if (noCommit) {
      console.log("[git] skipping auto-commit due to --no-commit flag");
      return;
    }

    const statusOutput = execSync(`git -C "${repoPath}" status --porcelain`, {
      encoding: "utf-8",
    });

    if (!statusOutput.trim()) {
      console.log("[git] nothing to commit");
      return;
    }

    execSync(`git -C "${repoPath}" add -A`, { stdio: "inherit" });

    // Truncate prompt to 72 characters for commit message
    const commitMessage =
      prompt.length > 72
        ? `claw: ${prompt.substring(0, 72)}`
        : `claw: ${prompt}`;

    execSync(`git -C "${repoPath}" commit -m "${commitMessage}"`, {
      stdio: "inherit",
    });
    console.log("[git] committed changes");
  }
  program
    .command("run <repo> <prompt>")
    .description("Run a single task directly in a repo")
    .option("--model <model>", "Model to use (overrides router)")
    .option("--delegate", "Force delegate mode (claude -p)")
    .option("--dry-run", "Show plan without executing")
    .option("--max-turns <n>", "Maximum agent turns", parseInt)
    .option("--no-resume", "Disable auto-resume on checkpoint")
    .option("--resume <sessionId>", "Resume a previous session by ID")
    .option("--no-commit", "Skip automatic git commit of changes")
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
          noCommit?: boolean;
        },
      ) => {
        const GITHUB_RE = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;
        let isGithubRepo = false;
        let tempDir: string | null = null;
        let repoPath = resolve(repo);

        if (GITHUB_RE.test(repo) && !existsSync(repoPath)) {
          const [owner, repoName] = repo.split("/");
          tempDir = `/tmp/claw-runs/${owner}-${repoName}-${Date.now()}`;
          mkdirSync(tempDir, { recursive: true });
          console.log(
            `[git] cloning https://github.com/${repo}.git → ${tempDir}`,
          );
          execSync(
            `git clone https://github.com/${owner}/${repoName}.git "${tempDir}"`,
            { stdio: "inherit" },
          );
          repoPath = tempDir;
          isGithubRepo = true;
        }

        if (opts.dryRun) {
          console.log(`[dry-run] Would run in ${repoPath}: "${prompt}"`);
          return;
        }

        const config = loadConfig();

        // LLM-based classification — fast Qwen call (~50 tokens, 8s timeout).
        // Falls back to "medium" on error so it never blocks execution.
        let complexity: "simple" | "medium" | "complex" = "medium";
        if (!opts.delegate) {
          const apiKey =
            process.env[config.providers.alibaba.api_key_env] ?? "";
          if (apiKey) {
            complexity = await classifyTask(prompt, {
              apiKey,
              baseUrl: config.providers.alibaba.base_url,
              model: config.models.default,
            });
          }
        }

        const route = routeTask(
          {
            complexity,
            description: prompt,
            fallbackChainPosition: 0,
            claudeBudgetPercent: 0,
          },
          config,
        );

        const mode = opts.delegate ? "delegate" : route.mode;

        console.log(`classify → ${complexity}`);
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
        let db: ReturnType<typeof getDb> | null = null;
        try {
          db = getDb({ connectionString: connStr });
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
            complexity,
            model:
              mode === "delegate"
                ? (opts.model ?? "claude")
                : config.models.default,
          });
          taskId = task.id;
          await updateWorkItemStatus(db, wi.id, "running");
          await updateTaskStatus(db, task.id, "running");
          void insertTelemetryEvent(db, {
            taskId: task.id,
            eventType: "routing_decision",
            payload: {
              complexity,
              mode,
              reason: opts.delegate ? "forced" : route.reason,
            },
          }).catch(() => {});
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
                if (db && taskId) {
                  void insertTelemetryEvent(db, {
                    taskId,
                    eventType: "tool_use",
                    payload: { name: event.name, input: event.input },
                  }).catch(() => {});
                }
              } else if (event.type === "token_update") {
                process.stderr.write(
                  `\r[tokens] ${event.used.toLocaleString()} / ${event.budget.toLocaleString()} (${event.percent}%)   `,
                );
                if (db && taskId) {
                  void insertTelemetryEvent(db, {
                    taskId,
                    eventType: "token_update",
                    payload: {
                      used: event.used,
                      budget: event.budget,
                      percent: event.percent,
                    },
                  }).catch(() => {});
                  void updateTaskTokens(db, taskId, event.used).catch(() => {});
                }
              } else if (event.type === "session_end") {
                endReason = event.reason;
                process.stderr.write("\n");
                if (db && taskId) {
                  void insertTelemetryEvent(db, {
                    taskId,
                    eventType: "session_end",
                    payload: { reason: event.reason },
                  }).catch(() => {});
                }
                if (event.reason === "completed") {
                  console.log("\n✅ done");
                  autoCommit(repoPath, prompt, !!opts.noCommit);
                  if (isGithubRepo) {
                    execSync(`git -C "${repoPath}" push origin HEAD`, {
                      stdio: "inherit",
                    });
                    if (tempDir) {
                      rmSync(tempDir, { recursive: true, force: true });
                      tempDir = null;
                    }
                  }
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
          } finally {
            if (tempDir) {
              rmSync(tempDir, { recursive: true, force: true });
              tempDir = null;
            }
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

          // Find the appropriate fallback chain position based on the model
          let fallbackChainPosition = 0;
          if (opts.model) {
            const fallbackChain = config.models.fallback_chain;
            const position = fallbackChain.findIndex(tier => tier.model === opts.model);
            if (position !== -1) {
              fallbackChainPosition = position;
            }
          }

          const baseAdapter = createAlibabaAdapter({
            name: "qwen-cli",
            model: opts.model ?? config.models.default,
            apiKey,
            baseUrl: config.providers.alibaba.base_url,
          });
          const adapter = withRetry(baseAdapter, {
            fallbackChainPosition,
            config,
            apiKey,
            baseUrl: config.providers.alibaba.base_url,
          });

          const db = taskId ? getDb({ connectionString: connStr }) : null;

          const sessionStore = await createProductionSessionStore(connStr);

          const sessionId = taskId ?? `session-${Date.now()}`;
          
          // Try to connect to Nexus MCP server
          let nexusHandle = null;
          let nexusWorkflowSection = "";
          try {
            nexusHandle = await connectNexusMcp({});
            if (nexusHandle) {
              console.log("[nexus] Connected to MCP server");
              
              // Call the 'nexus' tool with the task prompt to get workflow
              const nexusResult = await nexusHandle.callTool("nexus", { 
                intent: prompt 
              });
              
              if (!nexusResult.isError) {
                nexusWorkflowSection = `## Nexus Workflow\n${nexusResult.output}`;
                console.log("[nexus] Retrieved workflow for task");
              } else {
                console.warn("[nexus] Failed to retrieve workflow:", nexusResult.output);
              }
            } else {
              console.log("[nexus] MCP server not available, continuing without Nexus integration");
            }
          } catch (error) {
            console.warn("[nexus] Error connecting to MCP server:", error instanceof Error ? error.message : String(error));
          }

          const engineConfig = createQueryEngineConfig({
            maxTurns: opts.maxTurns ?? 200,
            maxTokens: adapter.maxContext,
            workspacePath: repoPath,
            sessionId,
            toolProfile: TOOL_PROFILE.full,
          });

          const projectContext = await loadProjectContext(repoPath);

          const systemPrompt = [
            `You are an autonomous coding agent working in the repository at ${repoPath}.`,
            "",
            "RULES — follow exactly:",
            "1. NEVER explain what you plan to do. Use tools immediately.",
            "2. Read files first, then write/edit. Never assume file contents.",
            "3. You are NOT done until: all files are changed AND verification passes.",
            "4. After every implementation, run: bash({command:'npx tsc --noEmit'}) then bash({command:'npx vitest run'}).",
            "5. If a command fails, read the error, fix it, re-run. Never give up silently.",
            "6. Do NOT return a text-only response until verification succeeds.",
            "7. Prefer edit_file for modifying existing files. Use write_file only for NEW files, and keep new files under 100 lines — split larger files.",
            "",
            "BEFORE WRITING ANY CODE, call nexus with your task intent to get the workflow. Follow the workflow phases in order.",
            ...(projectContext
              ? ["", "## Project Context", projectContext]
              : []),
            ...(nexusWorkflowSection ? ["", nexusWorkflowSection] : []),
          ].join("\n");

          // Combine built-in tools with Nexus MCP tools if available
          let allToolDefinitions = [...builtins.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          }))];

          if (nexusHandle) {
            allToolDefinitions = [...allToolDefinitions, ...nexusHandle.tools];
          }

          const port = createQueryEnginePort({
            config: engineConfig,
            adapter,
            systemPrompt,
            tools: allToolDefinitions,
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

          // Displays a single event to stdout/stderr. Returns the session_end
          // reason if the event is a session_end, otherwise null.
          async function* streamEvents(
            source: AsyncGenerator<
              import("../../harness/events.js").HarnessEvent
            >,
          ): AsyncGenerator<string | null> {
            for await (const event of source) {
              if (event.type === "text_delta") {
                process.stdout.write(event.text);
              } else if (event.type === "tool_use") {
                const input = JSON.stringify(event.input ?? {});
                const preview =
                  input.length > 60 ? input.slice(0, 57) + "..." : input;
                process.stderr.write(`\n[tool] ${event.name}(${preview})\n`);
                if (db && taskId) {
                  void insertTelemetryEvent(db, {
                    taskId,
                    eventType: event.type,
                    payload: { name: event.name, input: event.input },
                  }).catch(() => {});
                }
              } else if (event.type === "token_update") {
                process.stderr.write(
                  `\r[tokens] ${event.used.toLocaleString()} / ${event.budget.toLocaleString()} (${event.percent}%)   `,
                );
                if (db && taskId) {
                  void insertTelemetryEvent(db, {
                    taskId,
                    eventType: event.type,
                    payload: {
                      used: event.used,
                      budget: event.budget,
                      percent: event.percent,
                    },
                  }).catch(() => {});
                  void updateTaskTokens(db, taskId, event.used).catch(() => {});
                }
              } else if (event.type === "compaction") {
                process.stderr.write(
                  `\n[compaction] ${event.messagesBefore} → ${event.messagesAfter} messages (pass ${event.compactionCount})\n`,
                );
                if (db && taskId) {
                  void insertTelemetryEvent(db, {
                    taskId,
                    eventType: event.type,
                    payload: {
                      messagesBefore: event.messagesBefore,
                      messagesAfter: event.messagesAfter,
                    },
                  }).catch(() => {});
                }
              } else if (event.type === "api_retry") {
                process.stderr.write(
                  `\n[retry] attempt ${event.attempt}/${event.maxAttempts} — ${event.error} (wait ${event.delayMs}ms)\n`,
                );
                if (db && taskId) {
                  void insertTelemetryEvent(db, {
                    taskId,
                    eventType: event.type,
                    payload: {
                      attempt: event.attempt,
                      maxAttempts: event.maxAttempts,
                      error: event.error,
                    },
                  }).catch(() => {});
                }
              } else if (event.type === "session_resume") {
                process.stderr.write(
                  `\n⟳ Resuming session (pass ${event.resumeCount}/${MAX_RESUMES})\n`,
                );
              } else if (event.type === "session_end") {
                process.stderr.write("\n");
                if (db && taskId) {
                  void insertTelemetryEvent(db, {
                    taskId,
                    eventType: event.type,
                    payload: { reason: event.reason },
                  }).catch(() => {});
                }
                yield event.reason;
                return;
              }
            }
          }

          try {
            const initialStream = manualResumeId
              ? port.resume(manualResumeId)
              : port.run(prompt);

            let currentStream = initialStream;

            // Auto-resume loop: each checkpoint triggers a new resume pass
            // until completed, error, or MAX_RESUMES exhausted.
            while (true) {
              let checkpointed = false;

              for await (const reason of streamEvents(currentStream)) {
                endReason = reason ?? endReason;

                if (reason === "completed") {
                  console.log("\n✅ done");
                  autoCommit(repoPath, prompt, !!opts.noCommit);
                  if (isGithubRepo) {
                    execSync(`git -C "${repoPath}" push origin HEAD`, {
                      stdio: "inherit",
                    });
                    if (tempDir) {
                      rmSync(tempDir, { recursive: true, force: true });
                      tempDir = null;
                    }
                  }
                } else if (reason === "checkpoint") {
                  if (autoResume && resumeCount < MAX_RESUMES) {
                    resumeCount++;
                    console.log(
                      `\n⟳ Checkpoint reached. Compacting and resuming... [pass ${resumeCount}/${MAX_RESUMES}]`,
                    );
                    checkpointed = true;
                  } else {
                    console.log("\n📍 checkpoint saved");
                  }
                } else {
                  console.log(`\n⚠️  ended: ${reason}`);
                }
              }

              if (!checkpointed) break;
              currentStream = port.resume(sessionId);
            }
          } catch (err) {
            endReason = "failed";
            console.error("\n❌", (err as Error).message);
          } finally {
            // Disconnect Nexus MCP if connected
            if (nexusHandle) {
              try {
                await nexusHandle.disconnect();
                console.log("[nexus] Disconnected from MCP server");
              } catch (disconnectErr) {
                console.warn("[nexus] Error disconnecting from MCP server:", disconnectErr);
              }
            }
            
            if (tempDir) {
              rmSync(tempDir, { recursive: true, force: true });
              tempDir = null;
            }
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
