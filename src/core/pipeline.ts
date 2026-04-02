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
}

export interface PipelineResult {
  plan: string;
  executeSuccess: boolean;
  validation: ValidationResult;
  review: string;
  prUrl: string | null;
}

// ── PLAN ─────────────────────────────────────────────────────────────────────

interface PlanPhaseInput {
  repoPath: string;
  prompt: string;
  claudeBin: string;
  onEvent: (event: HarnessEvent) => void;
}

export async function planPhase({
  repoPath,
  prompt,
  claudeBin,
  onEvent,
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
}

export async function prPhase({
  repoPath,
  prompt,
  review,
  onEvent,
  openPr = true,
  execGh,
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
      const { execSync } = await import("node:child_process");
      return execSync(["gh", ...args].join(" "), {
        cwd,
        encoding: "utf-8",
      }).trim();
    });

  try {
    const url = await exec(
      [
        "pr",
        "create",
        "--title",
        JSON.stringify(title),
        "--body",
        JSON.stringify(review),
      ],
      repoPath,
    );
    const durationMs = Date.now() - start;
    onEvent({ type: "phase_end", phase: "pr", success: true, durationMs });
    return url;
  } catch (err: any) {
    const durationMs = Date.now() - start;
    onEvent({ type: "phase_end", phase: "pr", success: false, durationMs });
    throw new Error(`PR phase failed: ${err.message}`);
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
  } = input;
  const validationSteps = config.validation.typescript;

  const plan = await planPhase({ repoPath, prompt, claudeBin, onEvent });

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
    return { plan, executeSuccess: false, validation, review: "", prUrl: null };
  }

  const review = await reviewPhase({
    repoPath,
    prompt,
    claudeBin,
    onEvent,
    getDiff: input.getDiff,
  });
  const prUrl = await prPhase({ repoPath, prompt, review, onEvent, openPr });

  return { plan, executeSuccess: true, validation, review, prUrl };
}
