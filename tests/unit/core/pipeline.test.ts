import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HarnessEvent } from "../../../src/harness/events.js";
import type {
  PipelineContext,
  PipelineResult,
} from "../../../src/core/pipeline.js";

// ── Module-level mocks (hoisted) ─────────────────────────────────────────────

vi.mock("../../../src/integrations/claude-p/claude-pipe.js", () => ({
  runClaudePipe: vi.fn(async function* () {
    yield { type: "text_delta", text: "## Plan\n1. Do X\n2. Do Y" };
    yield { type: "session_end", reason: "completed" };
  }),
}));

vi.mock("../../../src/integrations/opencode/opencode-pipe.js", () => ({
  runOpencodePipe: vi.fn(async function* () {
    yield { type: "text_delta", text: "implementing..." };
    yield { type: "session_end", reason: "completed" };
  }),
}));

import { runClaudePipe } from "../../../src/integrations/claude-p/claude-pipe.js";
import { runOpencodePipe } from "../../../src/integrations/opencode/opencode-pipe.js";
import {
  planPhase,
  executePhase,
  validatePhase,
  reviewPhase,
  prPhase,
  runPipeline,
} from "../../../src/core/pipeline.js";

// ── Test config ──────────────────────────────────────────────────────────────

const testConfig = {
  validation: {
    typescript: [
      {
        name: "typecheck",
        command: "npx tsc --noEmit",
        required: true,
        retryable: true,
      },
    ],
    max_retries: 2,
    python: [],
  },
} as any;

// ── Reset mocks between tests ────────────────────────────────────────────────

beforeEach(() => {
  vi.mocked(runClaudePipe).mockImplementation(async function* () {
    yield { type: "text_delta", text: "## Plan\n1. Do X\n2. Do Y" };
    yield { type: "session_end", reason: "completed" };
  });
  vi.mocked(runOpencodePipe).mockImplementation(async function* () {
    yield { type: "text_delta", text: "implementing..." };
    yield { type: "session_end", reason: "completed" };
  });
});

// ── Phase event types ────────────────────────────────────────────────────────

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

// ── Pipeline types ───────────────────────────────────────────────────────────

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

// ── planPhase ────────────────────────────────────────────────────────────────

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
    vi.mocked(runClaudePipe).mockImplementation(async function* () {
      yield { type: "session_end", reason: "error" };
    });
    await expect(
      planPhase({
        repoPath: "/tmp/repo",
        prompt: "x",
        claudeBin: "claude",
        onEvent: () => {},
      }),
    ).rejects.toThrow();
  });
});

// ── executePhase ─────────────────────────────────────────────────────────────

describe("executePhase", () => {
  it("passes plan as context in the prompt", async () => {
    let capturedOpts: any = {};
    vi.mocked(runOpencodePipe).mockImplementation(async function* (opts: any) {
      capturedOpts = opts;
      yield { type: "session_end", reason: "completed" };
    });
    await executePhase({
      repoPath: "/tmp/repo",
      prompt: "add feature X",
      plan: "## Plan\n1. Do X",
      opencodeBin: "opencode",
      opencodeModel: "qwen3-coder-plus",
      onEvent: () => {},
    });
    expect(capturedOpts.prompt).toContain("## Plan");
    expect(capturedOpts.prompt).toContain("add feature X");
  });

  it("includes previous error in prompt on retry", async () => {
    let capturedOpts: any = {};
    vi.mocked(runOpencodePipe).mockImplementation(async function* (opts: any) {
      capturedOpts = opts;
      yield { type: "session_end", reason: "completed" };
    });
    await executePhase({
      repoPath: "/tmp/repo",
      prompt: "add feature X",
      plan: "plan",
      previousError: "tsc: error TS2304",
      opencodeBin: "opencode",
      opencodeModel: "qwen3-coder-plus",
      onEvent: () => {},
    });
    expect(capturedOpts.prompt).toContain("TS2304");
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

// ── validatePhase ────────────────────────────────────────────────────────────

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

// ── reviewPhase ──────────────────────────────────────────────────────────────

describe("reviewPhase", () => {
  it("passes git diff as context to claude -p", async () => {
    let capturedOpts: any = {};
    vi.mocked(runClaudePipe).mockImplementation(async function* (opts: any) {
      capturedOpts = opts;
      yield { type: "text_delta", text: "LGTM. Clean implementation." };
      yield { type: "session_end", reason: "completed" };
    });
    const review = await reviewPhase({
      repoPath: "/tmp/repo",
      prompt: "add feature X",
      claudeBin: "claude",
      onEvent: () => {},
      getDiff: async () => "diff --git a/file.ts\n+new code",
    });
    expect(review).toContain("LGTM");
    expect(capturedOpts.prompt).toContain("diff --git");
  });

  it("emits phase_start and phase_end events", async () => {
    vi.mocked(runClaudePipe).mockImplementation(async function* () {
      yield { type: "text_delta", text: "ok" };
      yield { type: "session_end", reason: "completed" };
    });
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

// ── prPhase ──────────────────────────────────────────────────────────────────

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

// ── runPipeline ──────────────────────────────────────────────────────────────

describe("runPipeline", () => {
  it("runs all 5 phases in sequence and returns PipelineResult", async () => {
    vi.mocked(runClaudePipe).mockImplementation(async function* () {
      yield { type: "text_delta", text: "## Plan\nDo the work" };
      yield { type: "session_end", reason: "completed" };
    });
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
    vi.mocked(runClaudePipe).mockImplementation(async function* () {
      yield { type: "text_delta", text: "plan text" };
      yield { type: "session_end", reason: "completed" };
    });
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
    vi.mocked(runClaudePipe).mockImplementation(async function* () {
      yield { type: "text_delta", text: "plan" };
      yield { type: "session_end", reason: "completed" };
    });
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
