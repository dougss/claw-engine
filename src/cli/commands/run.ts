import { resolve, basename } from "node:path";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { loadConfig } from "../../config.js";
import { routeTask } from "../../core/router.js";
import { runClaudePipe } from "../../integrations/claude-p/claude-pipe.js";
import { runOpencodePipe } from "../../integrations/opencode/opencode-pipe.js";
import { getDb } from "../../storage/db.js";
import {
  createWorkItem,
  updateWorkItemStatus,
  rollupWorkItemTokens,
} from "../../storage/repositories/work-items-repo.js";
import {
  createTask,
  updateTaskStatus,
  updateTaskTokens,
} from "../../storage/repositories/tasks-repo.js";
import { insertTelemetryEvent } from "../../storage/repositories/telemetry-repo.js";
import { classifyTask } from "../../core/classifier.js";
import { execSync } from "node:child_process";

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
    .option("--delegate", "Force claude -p regardless of complexity")
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
          { complexity, description: prompt, fallbackChainPosition: 0 },
          config,
        );

        const effectiveRoute = opts.delegate
          ? {
              ...route,
              provider: "anthropic",
              mode: "delegate" as const,
              reason: "forced claude -p",
            }
          : route;
        const mode = "delegate" as const;

        console.log(`classify → ${complexity}`);
        console.log(
          `routing → ${effectiveRoute.provider} (${effectiveRoute.reason})`,
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
            model: opts.model ?? effectiveRoute.model,
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
              reason: effectiveRoute.reason,
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
          const delegateProvider = effectiveRoute.provider;
          const delegateEvents =
            delegateProvider === "opencode"
              ? runOpencodePipe({
                  prompt,
                  model: opts.model ?? config.providers.opencode.default_model,
                  opencodeBin: config.providers.opencode.binary,
                  workspacePath: repoPath,
                })
              : runClaudePipe({
                  prompt,
                  model: opts.model,
                  claudeBin: config.providers.anthropic.binary,
                  workspacePath: repoPath,
                });

          let endReason = "completed";

          try {
            for await (const event of delegateEvents) {
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
                  if (workItemId) {
                    void rollupWorkItemTokens(db, workItemId).catch(() => {});
                  }
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
          // Engine mode removed — all execution is delegate (opencode or claude -p).
          // DashScope is used only for task classification (classifyTask).
        }
      },
    );
}
