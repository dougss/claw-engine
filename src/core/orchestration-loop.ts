import { Job } from "bullmq";
import { TaskJobData } from "./scheduler.js";
import { getDb } from "../storage/db.js";
import { Redis } from "ioredis";
import { ClawEngineConfig } from "../config-schema.js";
import { createWorktree, removeWorktree } from "../integrations/git/worktrees.js";
import { loadProjectContext } from "../harness/context-builder.js";
import { runOpencodePipe } from "../integrations/opencode/opencode-pipe.js";
import { runClaudePipe } from "../integrations/claude-p/claude-pipe.js";
import { runValidation } from "./validation-runner.js";
import { classifyError } from "./error-classifier.js";
import { sendAlert } from "../integrations/openclaw/client.js";
import { createPullRequest } from "../integrations/github/client.js";
import { publishEvent } from "../api/sse.js";
import { execSync } from "node:child_process";
import { homedir } from "node:os";

// Update repositories imports
import { updateTaskStatus } from "../storage/repositories/tasks-repo.js";
import { updateWorkItemStatus } from "../storage/repositories/work-items-repo.js";
import { updateTaskTokens, setTaskCheckpointData } from "../storage/repositories/tasks-repo.js";
import { insertTelemetryEvent } from "../storage/repositories/telemetry-repo.js";
import { updateWorkItemStatus as updateWorkItemRollup, rollupWorkItemTokens } from "../storage/repositories/work-items-repo.js";

interface OrchestrationContext {
  taskId: string;
  workItemId: string;
  repo: string; // absolute path to the repo
  branch: string;
  description: string;
  complexity: "simple" | "medium" | "complex";
  provider: string; // 'opencode' | 'anthropic'
  attempt: number;
  maxAttempts: number;
  db: ReturnType<typeof getDb>;
  redis: Redis;
  config: ClawEngineConfig;
}

export async function orchestrateTask(ctx: OrchestrationContext): Promise<void> {
  // Step 1 - Update status
  await updateTaskStatus(ctx.db, ctx.taskId, 'running');
  await updateWorkItemStatus(ctx.db, ctx.workItemId, 'running');
  await publishEvent(ctx.redis, { type: 'session_start', data: { taskId: ctx.taskId, model: ctx.provider } });

  let worktreePath: string | undefined = undefined;

  try {
    // Step 2 - Provision workspace
    const result = await createWorktree({
      repoPath: ctx.repo,
      worktreesDir: ctx.config.engine.worktrees_dir.replace("~", homedir()),
      taskId: ctx.taskId,
      branch: ctx.branch
    });
    worktreePath = result.worktreePath;

    // Step 3 - Load context
    const projectContext = await loadProjectContext(worktreePath);

    // Step 4 - Run delegate
    let delegateResult;
    if (ctx.provider === 'opencode') {
      delegateResult = runOpencodePipe({
        prompt: ctx.description,
        model: ctx.config.providers.opencode.default_model || 'qwen3.5-plus',
        workspacePath: worktreePath,
        opencodeBin: ctx.config.providers.opencode.binary
      });
    } else if (ctx.provider === 'anthropic') {
      delegateResult = runClaudePipe({
        prompt: ctx.description,
        workspacePath: worktreePath,
        claudeBin: ctx.config.providers.anthropic.binary,
        flags: ctx.config.providers.anthropic.flags
      });
    } else {
      // Default to opencode
      delegateResult = runOpencodePipe({
        prompt: ctx.description,
        model: ctx.config.providers.opencode.default_model || 'qwen3.5-plus',
        workspacePath: worktreePath,
        opencodeBin: ctx.config.providers.opencode.binary
      });
    }

    for await (const event of delegateResult) {
      // Best-effort event publishing
      try {
        await publishEvent(ctx.redis, { type: event.type, data: { taskId: ctx.taskId, ...event } });
      } catch (e) {
        console.warn(`Failed to publish event:`, e);
      }

      // Best-effort telemetry insertion
      try {
        await insertTelemetryEvent(ctx.db, { taskId: ctx.taskId, eventType: event.type, payload: event });
      } catch (e) {
        console.warn(`Failed to insert telemetry:`, e);
      }

      // Handle token updates
      if (event.type === 'token_update') {
        try {
          await updateTaskTokens(ctx.db, ctx.taskId, event.used);
        } catch (e) {
          console.warn(`Failed to update task tokens:`, e);
        }
      }

      // Handle checkpoints
      if (event.type === 'checkpoint') {
        try {
          await setTaskCheckpointData(ctx.db, ctx.taskId, { messages: event });
          await updateTaskStatus(ctx.db, ctx.taskId, 'checkpointing');
          return; // Exit early for checkpoint
        } catch (e) {
          console.warn(`Failed to save checkpoint data:`, e);
          throw e;
        }
      }

      // Handle session end
      if (event.type === 'session_end' && event.reason !== 'completed') {
        throw new Error(`Session ended with reason: ${event.reason}`);
      }
    }

    // Step 5 - Validate
    const hasTypescript = ['package.json', 'tsconfig.json'].some(file => 
      require('node:fs').existsSync(require('node:path').join(worktreePath!, file))
    );

    if (hasTypescript) {
      const validationResult = await runValidation({
        workspacePath: worktreePath,
        steps: ctx.config.validation.typescript,
        execCommand: (cmd: string) => execSync(cmd, { cwd: worktreePath, encoding: 'utf-8' })
      });

      // Store validation results
      // Note: We assume updateTaskStatus has validationResults parameter
      // We might need to adjust this depending on the actual DB schema
      
      // If validation fails and attempts remain, retry
      if (!validationResult.passed && ctx.attempt < ctx.maxAttempts) {
        const retryPrompt = `Previous attempt failed validation. Error output:\n${validationResult.output}\n\nPlease fix these issues and try again: ${ctx.description}`;
        
        // Recurse with incremented attempt
        const retryCtx: OrchestrationContext = {
          ...ctx,
          attempt: ctx.attempt + 1,
          description: retryPrompt
        };
        return await orchestrateTask(retryCtx);
      }

      // If validation fails and attempts exhausted
      if (!validationResult.passed && ctx.attempt >= ctx.maxAttempts) {
        throw new Error('validation_failed');
      }
    }

    // Step 6 - Create PR
    try {
      execSync('git add -A && git commit -m "claw: automated changes"', { cwd: worktreePath });
      execSync(`git push -u origin ${ctx.branch}`, { cwd: worktreePath });

      if (ctx.config.github.auto_create_pr) {
        const pr = await createPullRequest({
          repo: ctx.repo,
          branch: ctx.branch,
          title: `Automated changes: ${ctx.description.substring(0, 50)}...`,
          body: `Automated changes for task: ${ctx.description}`
        });

        // Note: Update task with PR info (implementation depends on your repo methods)
        // We might need to update tasks in the DB with PR info
      }
    } catch (e) {
      console.warn(`Failed to create PR:`, e);
      // Don't fail the whole task for PR creation failure
    }

    // Step 8 - Update DB
    await updateTaskStatus(ctx.db, ctx.taskId, 'completed');
    await rollupWorkItemTokens(ctx.db, ctx.workItemId);
    
    // Check if all tasks in work item are done
    // This would require checking if all related tasks are completed
    // Implementation depends on your work item logic
    await updateWorkItemRollup(ctx.db, ctx.workItemId, 'completed');

    // Step 9 - Publish completion
    await publishEvent(ctx.redis, { type: 'session_end', data: { taskId: ctx.taskId, reason: 'completed' } });

    // Step 10 - Notify
    await sendAlert({ 
      type: 'session_completed', 
      message: `✅ Task completed: ${ctx.description}.`, 
      taskId: ctx.taskId, 
      workItemId: ctx.workItemId 
    });
  } catch (error) {
    // Error handling
    try {
      const errorClass = classifyError((error as Error).message);
      
      // Determine if error is retryable
      const isRetryable = ['timeout', 'rate_limit', 'network'].includes(errorClass);
      
      if (isRetryable && ctx.attempt < ctx.maxAttempts) {
        // Retry with incremented attempt
        const retryCtx: OrchestrationContext = {
          ...ctx,
          attempt: ctx.attempt + 1
        };
        return await orchestrateTask(retryCtx);
      } else {
        // Fatal error or attempts exhausted
        await updateTaskStatus(ctx.db, ctx.taskId, 'failed');
        await publishEvent(ctx.redis, { type: 'session_end', data: { taskId: ctx.taskId, reason: 'error' } });
        await sendAlert({ 
          type: 'session_failed', 
          message: `❌ Task failed: ${errorClass}: ${(error as Error).message}`, 
          taskId: ctx.taskId 
        });
      }
    } catch (e) {
      console.error('Error during error handling:', e);
    }
  } finally {
    // Step 7 - Cleanup (in finally block)
    if (worktreePath) {
      try {
        await removeWorktree({ repoPath: ctx.repo, worktreePath });
      } catch (e) {
        console.warn(`Failed to cleanup worktree:`, e);
      }
    }
  }
}
