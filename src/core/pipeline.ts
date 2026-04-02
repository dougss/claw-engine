import { execSync } from "node:child_process";
import type { ClawEngineConfig } from "../config-schema.js";
import type { HarnessEvent, PipelinePhase } from "../harness/events.js";
import { runClaudePipe } from "../integrations/claude-p/claude-pipe.js";
import { runOpencodePipe } from "../integrations/opencode/opencode-pipe.js";
import {
  runValidation,
  type ValidationStep,
  type ValidationResult,
  type ExecCommandFn,
} from "./validation-runner.js";
import {
  getInstallationToken,
  readPrivateKey,
} from "../integrations/github/github-app-auth.js";
import { configureGitForApp } from "../integrations/github/git-config.js";

export interface PipelineContext {
  repoPath: string;
  prompt: string;
  config: ClawEngineConfig;
  claudeBin: string;
  opencodeBin: string;
  opencodeModel: string;
  maxRetries: number;
  openPr: boolean;
  onEvent: (event: HarnessEvent) => void;
  /** Optional MCP config JSON file path — passed to claude -p for PLAN phase. */
  mcpConfigPath?: string;
  /** GitHub App ID — enables bot-attributed commits and PRs when all three fields are set. */
  githubAppId?: string;
  /** GitHub App Installation ID for the target repo. */
  githubInstallationId?: string;
  /** Absolute path to the GitHub App private key (.pem). */
  githubPrivateKeyPath?: string;
  /** GitHub bot user ID — used to build the noreply commit email (e.g. 12345+claw-engine[bot]@...). */
  githubBotUserId?: string;
  maxReviewRetries?: number;  // default 1
  defaultBranch?: string;
}

export interface PipelineResult {
  plan: string;
  executeSuccess: boolean;
  validation: ValidationResult;
  review: string;
  prUrl: string | null;
  reviewPassed: boolean;
}

const GIT_EXEC_TIMEOUT_MS = 300_000;

function gitExecSyncOptions(repoPath: string) {
  return {
    cwd: repoPath,
    encoding: "utf-8" as const,
    timeout: GIT_EXEC_TIMEOUT_MS,
  };
}

function resolveDefaultBranch(repoPath: string): string {
  const opts = gitExecSyncOptions(repoPath);
  try {
    const sym = execSync("git symbolic-ref refs/remotes/origin/HEAD", opts)
      .trim();
    const last = sym.split("/").pop();
    if (last && last !== "HEAD") return last;
  } catch {}
  try {
    const out = execSync("git remote show origin", {
      ...opts,
      maxBuffer: 10 * 1024 * 1024,
    });
    const m = /HEAD branch:\s*(.+)/.exec(out);
    if (m?.[1]) return m[1].trim();
  } catch {}
  return "main";
}

function gitCommitAndPush(repoPath: string, prompt: string): string {
  const opts = gitExecSyncOptions(repoPath);

  const status = execSync("git status --porcelain", opts).trim();
  if (!status) throw new Error('nothing to commit — working tree is clean');

  const currentBranch = execSync(
    "git rev-parse --abbrev-ref HEAD",
    opts,
  ).trim();
  if (currentBranch === "HEAD") {
    throw new Error("Cannot commit from detached HEAD state");
  }
  let branch = currentBranch;
  const defaultBranch = getDefaultBranch(repoPath);
  if (currentBranch === defaultBranch || currentBranch === "HEAD") {
    branch = `claw/run-${Date.now()}`;
    execSync(`git checkout -b ${branch}`, opts);
  }

  execSync("git add -A", opts);
  const msg =
    prompt.length > 72 ? `claw: ${prompt.slice(0, 72)}` : `claw: ${prompt}`;
  execSync(`git commit -m ${JSON.stringify(msg)}`, opts);
  execSync("git push origin HEAD", opts);

  return branch;
}

// ── PLAN ─────────────────────────────────────────────────────────────────────

interface PlanPhaseInput {
  repoPath: string;
  prompt: string;
  claudeBin: string;
  onEvent: (event: HarnessEvent) => void;
  mcpConfigPath?: string;
}

export async function planPhase({
  repoPath,
  prompt,
  claudeBin,
  onEvent,
  mcpConfigPath,
}: PlanPhaseInput): Promise<string> {
  const start = Date.now();
  onEvent({ type: "phase_start", phase: "plan", attempt: 1 });

  const systemPrompt = [
    "You are a planning agent. You have Nexus MCP available.",
    "First call nexus_list to discover available skills.",
    "Then call nexus_get for any relevant skills.",
    "Produce a structured implementation plan based on the skills and the task.",
    "Output ONLY the plan text. No code implementation.",
  ].join("\n");

  const chunks: string[] = [];
  let endReason = "completed";

  const stream = runClaudePipe({
    prompt,
    systemPrompt,
    claudeBin,
    workspacePath: repoPath,
    mcpConfigPath,
  });

  for await (const event of stream) {
    if (event.type === "text_delta") chunks.push(event.text);
    else if (event.type === "session_end") endReason = event.reason;
    onEvent(event);
  }

  const durationMs = Date.now() - start;
  const success = endReason === "completed" && chunks.length > 0;
  onEvent({ type: "phase_end", phase: "plan", success, durationMs });

  if (!success) {
    throw new Error(
      `PLAN phase failed: session ended with reason "${endReason}"`,
    );
  }
  return chunks.join("");
}

// ── EXECUTE ───────────────────────────────────────────────────────────────────

interface ExecutePhaseInput {
  repoPath: string;
  prompt: string;
  plan: string;
  previousError?: string;
  opencodeBin: string;
  opencodeModel: string;
  onEvent: (event: HarnessEvent) => void;
  attempt?: number;
}

export async function executePhase({
  repoPath,
  prompt,
  plan,
  previousError,
  opencodeBin,
  opencodeModel,
  onEvent,
  attempt = 1,
}: ExecutePhaseInput): Promise<void> {
  const start = Date.now();
  onEvent({ type: "phase_start", phase: "execute", attempt });

  const parts = [`# Task\n${prompt}`, `# Implementation Plan\n${plan}`];
  if (previousError) {
    parts.push(`# Previous Validation Error (fix this)\n${previousError}`);
  }

  const stream = runOpencodePipe({
    prompt: parts.join("\n\n"),
    model: opencodeModel,
    opencodeBin,
    workspacePath: repoPath,
  });

  let endReason = "completed";
  for await (const event of stream) {
    if (event.type === "session_end") endReason = event.reason;
    onEvent(event);
  }

  const durationMs = Date.now() - start;
  const success = endReason === "completed";
  onEvent({ type: "phase_end", phase: "execute", success, durationMs });

  if (!success) {
    throw new Error(
      `EXECUTE phase failed: session ended with reason "${endReason}"`,
    );
  }
}

// ── VALIDATE ─────────────────────────────────────────────────────────────────

interface ValidatePhaseInput {
  repoPath: string;
  validationSteps: ValidationStep[];
  onEvent: (event: HarnessEvent) => void;
  execCommand?: ExecCommandFn;
  attempt?: number;
}

export async function validatePhase({
  repoPath,
  validationSteps,
  onEvent,
  execCommand,
  attempt = 1,
}: ValidatePhaseInput): Promise<ValidationResult> {
  const start = Date.now();
  onEvent({ type: "phase_start", phase: "validate", attempt });

  const exec: ExecCommandFn =
    execCommand ??
    (async (command, cwd) => {
      const { execSync } = await import("node:child_process");
      try {
        const stdout = execSync(command, {
          cwd,
          encoding: "utf-8",
          timeout: 300_000,
        });
        return { stdout, exitCode: 0 };
      } catch (err: any) {
        return { stdout: err.stdout ?? err.message, exitCode: err.status ?? 1 };
      }
    });

  const result = await runValidation({
    workspacePath: repoPath,
    steps: validationSteps,
    execCommand: exec,
  });

  onEvent({
    type: "validation_result",
    passed: result.passed,
    steps: result.steps,
  });

  const durationMs = Date.now() - start;
  onEvent({
    type: "phase_end",
    phase: "validate",
    success: result.passed,
    durationMs,
  });

  return result;
}

// ── REVIEW ───────────────────────────────────────────────────────────────────

interface ReviewPhaseInput {
  repoPath: string;
  prompt: string;
  claudeBin: string;
  onEvent: (event: HarnessEvent) => void;
  getDiff?: () => Promise<string>;
}

export async function reviewPhase({
  repoPath,
  prompt,
  claudeBin,
  onEvent,
  getDiff,
}: ReviewPhaseInput): Promise<string> {
  const start = Date.now();
  onEvent({ type: "phase_start", phase: "review", attempt: 1 });

  const diff = getDiff
    ? await getDiff()
    : await (async () => {
        const { execSync } = await import("node:child_process");
        return execSync("git diff HEAD~1", {
          cwd: repoPath,
          encoding: "utf-8",
        });
      })();

  const systemPrompt = [
    "You are a senior code reviewer.",
    "Review the following diff for correctness, performance, security, and style.",
    "Produce a structured review with: Summary, Issues Found, Suggestions, Verdict (APPROVE/REQUEST_CHANGES).",
  ].join("\n");

  const chunks: string[] = [];
  let endReason = "completed";

  const stream = runClaudePipe({
    prompt: `# Original Task\n${prompt}\n\n# Diff to Review\n\`\`\`diff\n${diff}\n\`\`\``,
    systemPrompt,
    claudeBin,
    workspacePath: repoPath,
  });

  for await (const event of stream) {
    if (event.type === "text_delta") chunks.push(event.text);
    else if (event.type === "session_end") endReason = event.reason;
    onEvent(event);
  }

  const durationMs = Date.now() - start;
  const success = endReason === "completed" && chunks.length > 0;
  onEvent({ type: "phase_end", phase: "review", success, durationMs });

  if (!success) {
    throw new Error(
      `REVIEW phase failed: session ended with reason "${endReason}"`,
    );
  }
  return chunks.join("");
}

// ── PR ────────────────────────────────────────────────────────────────────────

interface PrPhaseInput {
  repoPath: string;
  prompt: string;
  review: string;
  onEvent: (event: HarnessEvent) => void;
  openPr?: boolean;
  execGh?: (args: string[], cwd: string) => Promise<string>;
  branch?: string;
  baseBranch?: string;
}

export async function prPhase({
  repoPath,
  prompt,
  review,
  onEvent,
  openPr = true,
  execGh,
  branch,
  baseBranch,
}: PrPhaseInput): Promise<string | null> {
  if (!openPr) return null;

  const start = Date.now();
  onEvent({ type: "phase_start", phase: "pr", attempt: 1 });

  const title =
    prompt.length > 72
      ? `claw: ${prompt.substring(0, 69)}...`
      : `claw: ${prompt}`;

  const exec =
    execGh ??
    (async (args: string[], cwd: string) => {
      const { spawnSync } = await import("node:child_process");
      const result = spawnSync("gh", args, { cwd, encoding: "utf-8" });
      if (result.status !== 0) {
        throw new Error(result.stderr?.trim() || "gh pr create failed");
      }
      return result.stdout.trim();
    });

  try {
    const args = ["pr", "create", "--title", title, "--body", review];
    if (branch) {
      const base = baseBranch ?? resolveDefaultBranch(repoPath);
      args.push("--base", base, "--head", branch);
    }
    const url = await exec(args, repoPath);
    const durationMs = Date.now() - start;
    onEvent({ type: "phase_end", phase: "pr", success: true, durationMs });
    return url;
  } catch (err: any) {
    const durationMs = Date.now() - start;
    onEvent({ type: "phase_end", phase: "pr", success: false, durationMs });
    throw new Error(`PR phase failed: ${err.message}`);
  }
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

function parseReviewVerdict(review: string): 'APPROVE' | 'REQUEST_CHANGES' {
  const upper = review.toUpperCase();
  // Look for explicit APPROVE anywhere — check APPROVE before REQUEST_CHANGES
  // to avoid false-match on \"not APPROVE\"
  if (upper.includes('VERDICT') && upper.includes('REQUEST_CHANGES')) {
    return 'REQUEST_CHANGES';
  }
  if (upper.includes('VERDICT') && upper.includes('APPROVE')) {
    return 'APPROVE';
  }
  // Fallback: last line heuristic
  const lastLines = review.trim().split('\n').slice(-5).join(' ').toUpperCase();
  if (lastLines.includes('REQUEST_CHANGES')) return 'REQUEST_CHANGES';
  return 'APPROVE'; // default to approve if unclear
}

function getDefaultBranch(repoPath: string): string {
  try {
    const ref = execSync('git symbolic-ref refs/remotes/origin/HEAD', {
      cwd: repoPath, encoding: 'utf-8'
    }).trim();
    return ref.replace('refs/remotes/origin/', '');
  } catch {
    return 'main'; // fallback
  }
}

// ── ORCHESTRATOR ──────────────────────────────────────────────────────────────

interface RunPipelineInput extends PipelineContext {
  execCommand?: ExecCommandFn;
  getDiff?: () => Promise<string>;
}

export async function runPipeline(
  input: RunPipelineInput,
): Promise<PipelineResult> {
  const {
    repoPath,
    prompt,
    config,
    claudeBin,
    opencodeBin,
    opencodeModel,
    maxRetries,
    openPr,
    onEvent,
    mcpConfigPath,
    githubAppId,
    githubInstallationId,
    githubPrivateKeyPath,
    githubBotUserId,
    defaultBranch,
  } = input;
  const validationSteps = config.validation.typescript;
  const maxReviewRetries = input.maxReviewRetries ?? 1;

  // ── GitHub App auth ───────────────────────────────────────────────────────
  // If all three GitHub App fields are provided, obtain an installation token,
  // configure git to use it for pushes, and pass GH_TOKEN to the PR phase.
  let installationToken: string | undefined;
  if (githubAppId && githubInstallationId && githubPrivateKeyPath) {
    const privateKey = readPrivateKey(githubPrivateKeyPath);
    installationToken = await getInstallationToken(
      githubAppId,
      githubInstallationId,
      privateKey,
    );
    configureGitForApp({
      repoPath,
      token: installationToken,
      botUserId: githubBotUserId,
    });
  }

  // When a token is available, build a GH_TOKEN-aware execGh for the PR phase.
  let prExecGh: ((args: string[], cwd: string) => Promise<string>) | undefined;
  if (installationToken) {
    const token = installationToken;
    prExecGh = async (args: string[], cwd: string) => {
      const { spawnSync } = await import("node:child_process");
      const result = spawnSync("gh", args, {
        cwd,
        encoding: "utf-8",
        env: { ...process.env, GH_TOKEN: token },
      });
      if (result.status !== 0) {
        throw new Error(result.stderr?.trim() || "gh pr create failed");
      }
      return result.stdout.trim();
    };
  }
  // ─────────────────────────────────────────────────────────────────────────

  const plan = await planPhase({
    repoPath,
    prompt,
    claudeBin,
    onEvent,
    mcpConfigPath,
  });

  let validation: ValidationResult = { passed: false, steps: [] };
  let previousError: string | undefined;
  let executeSuccess = false;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    await executePhase({
      repoPath,
      prompt,
      plan,
      previousError,
      opencodeBin,
      opencodeModel,
      onEvent,
      attempt,
    });
    validation = await validatePhase({
      repoPath,
      validationSteps,
      onEvent,
      execCommand: input.execCommand,
      attempt,
    });

    if (validation.passed) {
      executeSuccess = true;
      break;
    }

    const failedSteps = validation.steps.filter((s) => !s.passed);
    previousError = failedSteps
      .map((s) => `${s.name}: ${s.output}`)
      .join("\n\n");

    if (attempt <= maxRetries) {
      console.log(
        `[pipeline] VALIDATE failed (attempt ${attempt}/${maxRetries + 1}), retrying EXECUTE...`,
      );
    }
  }

  if (!executeSuccess) {
    return { plan, executeSuccess: false, validation, review: "", prUrl: null, reviewPassed: false };
  }

  let review = '';
  let prUrl: string | null = null;
  let reviewPassed = false;
  let reviewAttempt = 0;
  const executeAttemptOffset = maxRetries + 1; // continue numbering from where validate left off

  while (reviewAttempt <= maxReviewRetries) {
    reviewAttempt++;

    review = await reviewPhase({
      repoPath,
      prompt,
      claudeBin,
      onEvent,
      getDiff: input.getDiff,
    });

    const verdict = parseReviewVerdict(review);

    if (verdict === 'APPROVE' || reviewAttempt > maxReviewRetries) {
      reviewPassed = verdict === 'APPROVE';
      break;
    }

    // REQUEST_CHANGES — loop back: execute to fix, then validate
    console.log(`[pipeline] REVIEW requested changes (attempt ${reviewAttempt}/${maxReviewRetries + 1}), fixing...`);

    await executePhase({
      repoPath,
      prompt,
      plan,
      previousError: `Code review requested changes:\n${review}`,
      opencodeBin,
      opencodeModel,
      onEvent,
      attempt: executeAttemptOffset + reviewAttempt,
    });

    const fixValidation = await validatePhase({
      repoPath,
      validationSteps,
      onEvent,
      execCommand: input.execCommand,
      attempt: executeAttemptOffset + reviewAttempt,
    });

    if (!fixValidation.passed) {
      // Validation failed after review fix — abort
      return { plan, executeSuccess: false, validation: fixValidation, review, prUrl: null, reviewPassed: false };
    }
  }

  // Commit, push, PR
  let prBranch: string | undefined;
  if (openPr) {
    try {
      prBranch = gitCommitAndPush(repoPath, prompt);
    } catch (err: any) {
      if (err.message.includes('nothing to commit')) {
        console.log('[pipeline] nothing to commit, skipping PR');
        return { plan, executeSuccess: true, validation, review, prUrl: null, reviewPassed };
      }
      throw new Error(`Failed to commit/push for PR: ${err.message}`);
    }
  }

  const defaultBranch = getDefaultBranch(repoPath);
  const prBase = defaultBranch ?? resolveDefaultBranch(repoPath);

  const prUrl = await prPhase({
    repoPath,
    prompt,
    review,
    onEvent,
    openPr,
    execGh: prExecGh,
    branch: prBranch,
    baseBranch: prBase,
  });

  return { plan, executeSuccess: true, validation, review, prUrl, reviewPassed };
}
