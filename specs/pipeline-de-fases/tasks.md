# Implementation Tasks — Pipeline de Fases

## Task 1: Extend HarnessEvent with Phase Events

**Files:**

- Modify: `src/harness/events.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/core/pipeline.test.ts
import { describe, it, expect } from "vitest";
import type { HarnessEvent } from "../../../src/harness/events.js";

describe("phase events", () => {
  it("phase_start event has correct shape", () => {
    const event: HarnessEvent = {
      type: "phase_start",
      phase: "plan",
      attempt: 1,
    };
    expect(event.type).toBe("phase_start");
    expect(event.phase).toBe("plan");
  });

  it("phase_end event has correct shape", () => {
    const event: HarnessEvent = {
      type: "phase_end",
      phase: "plan",
      success: true,
      durationMs: 1234,
    };
    expect(event.type).toBe("phase_end");
    expect(event.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
      Run: `npm test -- tests/unit/core/pipeline.test.ts`
      Expected: FAIL — TypeScript error, `phase_start` not in `HarnessEvent` union

- [ ] **Step 3: Add phase events to HarnessEvent union in `src/harness/events.ts`**

```typescript
export type PipelinePhase =
  | "plan"
  | "execute"
  | "validate"
  | "review"
  | "pr"

  // Add to HarnessEvent union:
  | { type: "phase_start"; phase: PipelinePhase; attempt: number }
  | {
      type: "phase_end";
      phase: PipelinePhase;
      success: boolean;
      durationMs: number;
    };
```

- [ ] **Step 4: Run test to verify it passes**
      Expected: PASS

- [ ] **Step 5: Commit**
      `git commit -m "feat(events): add phase_start/phase_end to HarnessEvent"`

---

## Task 2: Create Pipeline Types and PipelineContext

**Files:**

- Create: `src/core/pipeline.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/core/pipeline.test.ts (append)
import type {
  PipelineContext,
  PipelineResult,
} from "../../../src/core/pipeline.js";

describe("pipeline types", () => {
  it("PipelineContext has all required fields", () => {
    const ctx: PipelineContext = {
      repoPath: "/tmp/repo",
      prompt: "add feature X",
      config: {} as any,
      claudeBin: "claude",
      opencodeBin: "opencode",
      opencodeModel: "dashscope/qwen3-coder-plus",
      maxRetries: 2,
      openPr: false,
      onEvent: () => {},
    };
    expect(ctx.repoPath).toBe("/tmp/repo");
  });

  it("PipelineResult has all phase outputs", () => {
    const result: PipelineResult = {
      plan: "the plan",
      executeSuccess: true,
      validation: { passed: true, steps: [] },
      review: "looks good",
      prUrl: null,
    };
    expect(result.plan).toBe("the plan");
    expect(result.prUrl).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
      Run: `npm test -- tests/unit/core/pipeline.test.ts`
      Expected: FAIL — module not found

- [ ] **Step 3: Create `src/core/pipeline.ts` with types and skeleton**

```typescript
import type { ClawEngineConfig } from "../config-schema.js";
import type { HarnessEvent, PipelinePhase } from "../harness/events.js";
import type { ValidationResult } from "./validation-runner.js";

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
```

- [ ] **Step 4: Run test to verify it passes**
      Expected: PASS

- [ ] **Step 5: Commit**
      `git commit -m "feat(pipeline): add PipelineContext and PipelineResult types"`

---

## Task 3: Implement `planPhase` — PLAN via claude -p with Nexus

**Files:**

- Modify: `src/core/pipeline.ts`
- Append: `tests/unit/core/pipeline.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from "vitest";
import { planPhase } from "../../../src/core/pipeline.js";

vi.mock("../../../src/integrations/claude-p/claude-pipe.js", () => ({
  runClaudePipe: async function* (opts: any) {
    yield { type: "text_delta", text: "## Plan\n1. Do X\n2. Do Y" };
    yield { type: "session_end", reason: "completed" };
  },
}));

describe("planPhase", () => {
  it("returns plan text from claude -p output", async () => {
    const events: any[] = [];
    const plan = await planPhase({
      repoPath: "/tmp/repo",
      prompt: "add feature X",
      claudeBin: "claude",
      onEvent: (e) => events.push(e),
    });
    expect(plan).toContain("## Plan");
    expect(plan).toContain("Do X");
  });

  it("emits phase_start and phase_end events", async () => {
    const events: any[] = [];
    await planPhase({
      repoPath: "/tmp/repo",
      prompt: "add feature X",
      claudeBin: "claude",
      onEvent: (e) => events.push(e),
    });
    expect(
      events.some((e) => e.type === "phase_start" && e.phase === "plan"),
    ).toBe(true);
    expect(
      events.some(
        (e) => e.type === "phase_end" && e.phase === "plan" && e.success,
      ),
    ).toBe(true);
  });

  it("throws if claude -p ends with error", async () => {
    vi.doMock("../../../src/integrations/claude-p/claude-pipe.js", () => ({
      runClaudePipe: async function* () {
        yield { type: "session_end", reason: "error" };
      },
    }));
    const { planPhase: planFresh } =
      await import("../../../src/core/pipeline.js");
    await expect(
      planFresh({
        repoPath: "/tmp/repo",
        prompt: "x",
        claudeBin: "claude",
        onEvent: () => {},
      }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
      Expected: FAIL — `planPhase` not exported

- [ ] **Step 3: Implement `planPhase` in `src/core/pipeline.ts`**

```typescript
import { runClaudePipe } from "../integrations/claude-p/claude-pipe.js";

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
```

- [ ] **Step 4: Run test to verify it passes**
      Expected: PASS

- [ ] **Step 5: Commit**
      `git commit -m "feat(pipeline): implement planPhase with claude -p + Nexus"`

---

## Task 4: Implement `executePhase` — EXECUTE via opencode

**Files:**

- Modify: `src/core/pipeline.ts`
- Append: `tests/unit/core/pipeline.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
vi.mock("../../../src/integrations/opencode/opencode-pipe.js", () => ({
  runOpencodePipe: async function* (opts: any) {
    yield { type: "text_delta", text: "implementing..." };
    yield { type: "session_end", reason: "completed" };
  },
}));

describe("executePhase", () => {
  it("passes plan as context in the prompt", async () => {
    let capturedPrompt = "";
    vi.doMock("../../../src/integrations/opencode/opencode-pipe.js", () => ({
      runOpencodePipe: async function* (opts: any) {
        capturedPrompt = opts.prompt;
        yield { type: "session_end", reason: "completed" };
      },
    }));
    const { executePhase } = await import("../../../src/core/pipeline.js");
    await executePhase({
      repoPath: "/tmp/repo",
      prompt: "add feature X",
      plan: "## Plan\n1. Do X",
      opencodeBin: "opencode",
      opencodeModel: "qwen3-coder-plus",
      onEvent: () => {},
    });
    expect(capturedPrompt).toContain("## Plan");
    expect(capturedPrompt).toContain("add feature X");
  });

  it("includes previous error in prompt on retry", async () => {
    let capturedPrompt = "";
    vi.doMock("../../../src/integrations/opencode/opencode-pipe.js", () => ({
      runOpencodePipe: async function* (opts: any) {
        capturedPrompt = opts.prompt;
        yield { type: "session_end", reason: "completed" };
      },
    }));
    const { executePhase } = await import("../../../src/core/pipeline.js");
    await executePhase({
      repoPath: "/tmp/repo",
      prompt: "add feature X",
      plan: "plan",
      previousError: "tsc: error TS2304",
      opencodeBin: "opencode",
      opencodeModel: "qwen3-coder-plus",
      onEvent: () => {},
    });
    expect(capturedPrompt).toContain("TS2304");
  });

  it("emits phase_start and phase_end events", async () => {
    const events: any[] = [];
    await executePhase({
      repoPath: "/tmp/repo",
      prompt: "add feature X",
      plan: "plan",
      opencodeBin: "opencode",
      opencodeModel: "qwen3-coder-plus",
      onEvent: (e) => events.push(e),
    });
    expect(
      events.some((e) => e.type === "phase_start" && e.phase === "execute"),
    ).toBe(true);
    expect(
      events.some((e) => e.type === "phase_end" && e.phase === "execute"),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
      Expected: FAIL — `executePhase` not exported

- [ ] **Step 3: Implement `executePhase` in `src/core/pipeline.ts`**

```typescript
import { runOpencodePipe } from "../integrations/opencode/opencode-pipe.js";

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
```

- [ ] **Step 4: Run test to verify it passes**
      Expected: PASS

- [ ] **Step 5: Commit**
      `git commit -m "feat(pipeline): implement executePhase with opencode"`

---

## Task 5: Implement `validatePhase` — VALIDATE via execSync

**Files:**

- Modify: `src/core/pipeline.ts`
- Append: `tests/unit/core/pipeline.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { validatePhase } from "../../../src/core/pipeline.js";

describe("validatePhase", () => {
  it("returns validation result from runValidation", async () => {
    const result = await validatePhase({
      repoPath: "/tmp/repo",
      validationSteps: [
        {
          name: "typecheck",
          command: "echo ok",
          required: true,
          retryable: true,
        },
      ],
      onEvent: () => {},
      execCommand: async () => ({ stdout: "ok", exitCode: 0 }),
    });
    expect(result.passed).toBe(true);
    expect(result.steps).toHaveLength(1);
  });

  it("returns failed result when required step fails", async () => {
    const result = await validatePhase({
      repoPath: "/tmp/repo",
      validationSteps: [
        { name: "typecheck", command: "tsc", required: true, retryable: true },
      ],
      onEvent: () => {},
      execCommand: async () => ({ stdout: "error TS2304", exitCode: 1 }),
    });
    expect(result.passed).toBe(false);
  });

  it("emits phase_start, validation_result, and phase_end events", async () => {
    const events: any[] = [];
    await validatePhase({
      repoPath: "/tmp/repo",
      validationSteps: [
        { name: "test", command: "npm test", required: true, retryable: true },
      ],
      onEvent: (e) => events.push(e),
      execCommand: async () => ({ stdout: "pass", exitCode: 0 }),
    });
    expect(
      events.some((e) => e.type === "phase_start" && e.phase === "validate"),
    ).toBe(true);
    expect(events.some((e) => e.type === "validation_result")).toBe(true);
    expect(
      events.some((e) => e.type === "phase_end" && e.phase === "validate"),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
      Expected: FAIL — `validatePhase` not exported

- [ ] **Step 3: Implement `validatePhase` in `src/core/pipeline.ts`**

```typescript
import {
  runValidation,
  type ValidationStep,
  type ValidationResult,
  type ExecCommandFn,
} from "./validation-runner.js";

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
```

- [ ] **Step 4: Run test to verify it passes**
      Expected: PASS

- [ ] **Step 5: Commit**
      `git commit -m "feat(pipeline): implement validatePhase with validation-runner"`

---

## Task 6: Implement `reviewPhase` — REVIEW via claude -p

**Files:**

- Modify: `src/core/pipeline.ts`
- Append: `tests/unit/core/pipeline.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
describe("reviewPhase", () => {
  it("passes git diff as context to claude -p", async () => {
    let capturedPrompt = "";
    vi.doMock("../../../src/integrations/claude-p/claude-pipe.js", () => ({
      runClaudePipe: async function* (opts: any) {
        capturedPrompt = opts.prompt;
        yield { type: "text_delta", text: "LGTM. Clean implementation." };
        yield { type: "session_end", reason: "completed" };
      },
    }));
    const { reviewPhase } = await import("../../../src/core/pipeline.js");
    const review = await reviewPhase({
      repoPath: "/tmp/repo",
      prompt: "add feature X",
      claudeBin: "claude",
      onEvent: () => {},
      getDiff: async () => "diff --git a/file.ts\n+new code",
    });
    expect(review).toContain("LGTM");
    expect(capturedPrompt).toContain("diff --git");
  });

  it("emits phase_start and phase_end events", async () => {
    vi.doMock("../../../src/integrations/claude-p/claude-pipe.js", () => ({
      runClaudePipe: async function* () {
        yield { type: "text_delta", text: "ok" };
        yield { type: "session_end", reason: "completed" };
      },
    }));
    const { reviewPhase } = await import("../../../src/core/pipeline.js");
    const events: any[] = [];
    await reviewPhase({
      repoPath: "/tmp/repo",
      prompt: "x",
      claudeBin: "claude",
      onEvent: (e) => events.push(e),
      getDiff: async () => "diff",
    });
    expect(
      events.some((e) => e.type === "phase_start" && e.phase === "review"),
    ).toBe(true);
    expect(
      events.some(
        (e) => e.type === "phase_end" && e.phase === "review" && e.success,
      ),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
      Expected: FAIL — `reviewPhase` not exported

- [ ] **Step 3: Implement `reviewPhase` in `src/core/pipeline.ts`**

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**
      Expected: PASS

- [ ] **Step 5: Commit**
      `git commit -m "feat(pipeline): implement reviewPhase with claude -p"`

---

## Task 7: Implement `prPhase` — PR via gh

**Files:**

- Modify: `src/core/pipeline.ts`
- Append: `tests/unit/core/pipeline.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
describe("prPhase", () => {
  it("creates PR and returns URL", async () => {
    const result = await prPhase({
      repoPath: "/tmp/repo",
      prompt: "add feature X",
      review: "LGTM. Approved.",
      onEvent: () => {},
      execGh: async () => "https://github.com/dougss/repo/pull/42",
    });
    expect(result).toBe("https://github.com/dougss/repo/pull/42");
  });

  it("returns null when openPr is false", async () => {
    const result = await prPhase({
      repoPath: "/tmp/repo",
      prompt: "add feature X",
      review: "ok",
      onEvent: () => {},
      openPr: false,
    });
    expect(result).toBeNull();
  });

  it("emits phase_start and phase_end events", async () => {
    const events: any[] = [];
    await prPhase({
      repoPath: "/tmp/repo",
      prompt: "x",
      review: "ok",
      onEvent: (e) => events.push(e),
      execGh: async () => "https://github.com/test/pr/1",
    });
    expect(
      events.some((e) => e.type === "phase_start" && e.phase === "pr"),
    ).toBe(true);
    expect(events.some((e) => e.type === "phase_end" && e.phase === "pr")).toBe(
      true,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
      Expected: FAIL — `prPhase` not exported

- [ ] **Step 3: Implement `prPhase` in `src/core/pipeline.ts`**

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**
      Expected: PASS

- [ ] **Step 5: Commit**
      `git commit -m "feat(pipeline): implement prPhase with gh pr create"`

---

## Task 8: Implement `runPipeline` Orchestrator with Retry Loop

**Files:**

- Modify: `src/core/pipeline.ts`
- Append: `tests/unit/core/pipeline.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
describe("runPipeline", () => {
  it("runs all 5 phases in sequence and returns PipelineResult", async () => {
    const events: any[] = [];
    const result = await runPipeline({
      repoPath: "/tmp/repo",
      prompt: "add feature X",
      config: testConfig,
      claudeBin: "claude",
      opencodeBin: "opencode",
      opencodeModel: "qwen3-coder-plus",
      maxRetries: 2,
      openPr: false,
      onEvent: (e) => events.push(e),
      execCommand: async () => ({ stdout: "ok", exitCode: 0 }),
      getDiff: async () => "diff --git a/file.ts",
    });
    expect(result.plan).toBeTruthy();
    expect(result.executeSuccess).toBe(true);
    expect(result.validation.passed).toBe(true);
    expect(result.review).toBeTruthy();
    expect(result.prUrl).toBeNull();
    const phaseStarts = events.filter((e) => e.type === "phase_start");
    expect(phaseStarts.map((e) => e.phase)).toEqual([
      "plan",
      "execute",
      "validate",
      "review",
    ]);
  });

  it("retries EXECUTE when VALIDATE fails, up to maxRetries", async () => {
    let validateCallCount = 0;
    const result = await runPipeline({
      repoPath: "/tmp/repo",
      prompt: "add feature X",
      config: testConfig,
      claudeBin: "claude",
      opencodeBin: "opencode",
      opencodeModel: "qwen3-coder-plus",
      maxRetries: 2,
      openPr: false,
      onEvent: () => {},
      execCommand: async () => {
        validateCallCount++;
        if (validateCallCount <= 2)
          return { stdout: "error TS2304", exitCode: 1 };
        return { stdout: "ok", exitCode: 0 };
      },
      getDiff: async () => "diff",
    });
    expect(validateCallCount).toBe(3); // initial + 2 retries
    expect(result.validation.passed).toBe(true);
  });

  it("fails after exhausting retries", async () => {
    const result = await runPipeline({
      repoPath: "/tmp/repo",
      prompt: "x",
      config: testConfig,
      claudeBin: "claude",
      opencodeBin: "opencode",
      opencodeModel: "qwen3-coder-plus",
      maxRetries: 1,
      openPr: false,
      onEvent: () => {},
      execCommand: async () => ({ stdout: "always fails", exitCode: 1 }),
      getDiff: async () => "diff",
    });
    expect(result.validation.passed).toBe(false);
    expect(result.executeSuccess).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
      Expected: FAIL — `runPipeline` not exported

- [ ] **Step 3: Implement `runPipeline` in `src/core/pipeline.ts`**

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**
      Expected: PASS

- [ ] **Step 5: Commit**
      `git commit -m "feat(pipeline): implement runPipeline orchestrator with retry loop"`

---

## Task 9: Wire `--pipeline` and `--pr` Flags into `run.ts`

**Files:**

- Modify: `src/cli/commands/run.ts`

- [ ] **Step 1: Verificar que TypeScript falha antes**
      Run: `npx tsc --noEmit`
      Expected: FAIL — import de `pipeline.ts` ainda não existe

- [ ] **Step 2: Adicionar opções ao comando**

```typescript
.option("--pipeline", "Use 5-phase pipeline (plan → execute → validate → review → pr)")
.option("--pr", "Open a PR after pipeline completes (requires --pipeline)")
```

Adicionar ao tipo de `opts`:

```typescript
pipeline?: boolean
pr?: boolean
```

- [ ] **Step 3: Adicionar o ramo pipeline antes do bloco delegate**

Após o bloco de console.log + registro no DB, antes de `if (mode === "delegate")`:

```typescript
if (opts.pipeline) {
  const { runPipeline } = await import("../../core/pipeline.js");

  const result = await runPipeline({
    repoPath,
    prompt,
    config,
    claudeBin: config.providers.anthropic.binary,
    opencodeBin: config.providers.opencode.binary,
    opencodeModel:
      opts.model ??
      config.providers.opencode.default_model ??
      "dashscope/qwen3-coder-plus",
    maxRetries: config.validation.max_retries,
    openPr: !!opts.pr,
    onEvent: (event) => {
      if (event.type === "text_delta") {
        process.stdout.write(event.text);
      } else if (event.type === "phase_start") {
        console.log(
          `\n[pipeline] ▶ ${event.phase.toUpperCase()} (attempt ${event.attempt})`,
        );
      } else if (event.type === "phase_end") {
        const icon = event.success ? "✅" : "❌";
        console.log(
          `[pipeline] ${icon} ${event.phase.toUpperCase()} (${event.durationMs}ms)`,
        );
      } else if (event.type === "validation_result") {
        for (const step of event.steps) {
          const icon = step.passed ? "✓" : "✗";
          console.log(`  ${icon} ${step.name} (${step.durationMs}ms)`);
        }
      }
      if (db && taskId) {
        void insertTelemetryEvent(db, {
          taskId,
          eventType: event.type,
          payload: event,
        }).catch(() => {});
      }
    },
  });

  if (result.executeSuccess) {
    autoCommit(repoPath, prompt, !!opts.noCommit);
    console.log("\n✅ pipeline complete");
    if (result.prUrl) console.log(`PR: ${result.prUrl}`);
    await finalizeDb("completed", "completed");
  } else {
    console.log("\n❌ pipeline failed (validation did not pass after retries)");
    await finalizeDb("failed", "failed");
  }
  return;
}
```

- [ ] **Step 4: Verificar TypeScript**
      Run: `npx tsc --noEmit`
      Expected: 0 erros

- [ ] **Step 5: Verificar testes existentes**
      Run: `npm test`
      Expected: 203+ testes passando

- [ ] **Step 6: Commit**
      `git commit -m "feat(cli): wire --pipeline and --pr flags into claw run"`

---

## Task 10: Final Verification

- [ ] **Step 1:** `npx tsc --noEmit` — 0 erros
- [ ] **Step 2:** `npm test` — 203 existentes + novos pipeline tests passando
- [ ] **Step 3: Smoke test (opcional)**

```bash
cd ~/server/apps/claw-engine
source ~/.openclaw/secrets/.env
npm run claw -- run /tmp/test-repo "add a hello world function" --pipeline --dry-run
```
