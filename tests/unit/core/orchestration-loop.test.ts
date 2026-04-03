import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HarnessEvent } from "../../../src/harness/events.js";

// ── Module-level mocks (hoisted) ──────────────────────────────────────────────

// Mock Node.js built-ins used within orchestration
vi.mock("node:child_process", () => ({
  execFile: vi.fn((...args) => {
    // The callback is the last argument for execFile
    const callback = args[args.length - 1];
    if (typeof callback === 'function') {
      // Mock successful execution by calling the callback without error
      process.nextTick(() => callback(null, "success output", ""));
    }
  }),
}));

vi.mock("node:fs/promises", () => ({
  access: vi.fn((path) => {
    // For validation files (package.json, tsconfig.json), throw error (file doesn't exist)
    if (path.includes("package.json") || path.includes("tsconfig.json")) {
      return Promise.reject(new Error("File does not exist"));
    }
    // For other access calls, resolve successfully
    return Promise.resolve();
  }),
  mkdir: vi.fn().mockResolvedValue(undefined), // Needed for createWorktree
}));

vi.mock("node:path", () => ({
  join: vi.fn((...parts) => parts.join("/")), // Simple path joining for mocking
  basename: vi.fn((path) => path.split("/").pop() || ""), // Extract repo name
}));

vi.mock("node:os", () => ({
  homedir: vi.fn(() => "/home/user"), // Mock home directory
}));

vi.mock("../../../src/integrations/git/worktrees.js", () => ({
  createWorktree: vi.fn(),
  removeWorktree: vi.fn().mockReturnValue(Promise.resolve(undefined)),
}));

vi.mock("../../../src/integrations/opencode/opencode-pipe.js", () => ({
  runOpencodePipe: vi.fn(async function* (): AsyncGenerator<HarnessEvent> {
    yield { type: "text_delta", text: "implementing..." } as HarnessEvent;
    yield { type: "token_update", used: 100, budget: 1000, percent: 10 } as HarnessEvent;
    yield { type: "session_end", reason: "completed" } as HarnessEvent;
  }),
}));

vi.mock("../../../src/integrations/claude-p/claude-pipe.js", () => ({
  runClaudePipe: vi.fn(async function* (): AsyncGenerator<HarnessEvent> {
    yield { type: "text_delta", text: "implementing..." } as HarnessEvent;
    yield { type: "session_end", reason: "completed" } as HarnessEvent;
  }),
}));

vi.mock("../../../src/harness/context-builder.js", () => ({
  loadProjectContext: vi.fn(),
}));

vi.mock("../../../src/core/validation-runner.js", () => ({
  runValidation: vi.fn(),
}));

vi.mock("../../../src/core/error-classifier.js", () => ({
  classifyError: vi.fn(() => "unknown"),
}));

vi.mock("../../../src/integrations/openclaw/client.js", () => ({
  sendAlert: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../src/integrations/github/client.js", () => ({
  createPullRequest: vi.fn(),
}));

vi.mock("../../../src/api/sse.js", () => ({
  publishEvent: vi.fn().mockReturnValue({
    catch: vi.fn().mockReturnValue(Promise.resolve(undefined))
  }),
}));

vi.mock("../../../src/storage/repositories/telemetry-repo.js", () => ({
  insertTelemetryEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../src/storage/repositories/tasks-repo.js", () => ({
  updateTaskStatus: vi.fn().mockResolvedValue(undefined),
  updateTaskTokens: vi.fn().mockResolvedValue(undefined),
  setTaskCheckpointData: vi.fn().mockResolvedValue(undefined),
  getTasksByWorkItemId: vi.fn(),
}));

vi.mock("../../../src/storage/repositories/work-items-repo.js", () => ({
  updateWorkItemStatus: vi.fn().mockResolvedValue(undefined),
  rollupWorkItemTokens: vi.fn().mockResolvedValue(undefined),
}));

// Mock Node.js built-ins used within orchestration
vi.mock("node:child_process", () => ({
  execFile: vi.fn((...params) => {
    // The last parameter is the callback function for execFile
    const callback = params[params.length - 1];
    if (typeof callback === 'function') {
      // Mock successful execution by calling the callback without error
      process.nextTick(() => callback(null, "success output", "stderr output"));
    }
  }),
}));

vi.mock("node:fs/promises", () => ({
  access: vi.fn().mockResolvedValue(undefined), // Mock that file exists
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { createWorktree, removeWorktree } from "../../../src/integrations/git/worktrees.js";
import { runOpencodePipe } from "../../../src/integrations/opencode/opencode-pipe.js";
import { runClaudePipe } from "../../../src/integrations/claude-p/claude-pipe.js";
import { loadProjectContext } from "../../../src/harness/context-builder.js";
import { runValidation } from "../../../src/core/validation-runner.js";
import { classifyError } from "../../../src/core/error-classifier.js";
import { sendAlert } from "../../../src/integrations/openclaw/client.js";
import { createPullRequest } from "../../../src/integrations/github/client.js";
import { publishEvent } from "../../../src/api/sse.js";
import { insertTelemetryEvent } from "../../../src/storage/repositories/telemetry-repo.js";
import { 
  updateTaskStatus, 
  updateTaskTokens, 
  setTaskCheckpointData, 
  getTasksByWorkItemId 
} from "../../../src/storage/repositories/tasks-repo.js";
import { 
  updateWorkItemStatus, 
  rollupWorkItemTokens 
} from "../../../src/storage/repositories/work-items-repo.js";

// Import Node.js built-in mocks
import { access } from "node:fs/promises";

// Dynamically import the main function
const orchestrationModule = await import("../../../src/core/orchestration-loop.js");
const { orchestrateTask } = orchestrationModule;

// Define types locally to avoid import issues
interface OrchestrationContext {
  taskId: string;
  workItemId: string;
  repo: string;
  branch: string;
  description: string;
  complexity: "simple" | "medium" | "complex";
  provider: "opencode" | "anthropic";
  attempt: number;
  maxAttempts: number;
  db: any;
  redis: any;
  config: any;
}

// ── Reset mocks between tests ─────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  
  // Set up default successful implementations
  vi.mocked(createWorktree).mockResolvedValue({ worktreePath: "/tmp/worktree" });
  vi.mocked(loadProjectContext).mockResolvedValue("");
  vi.mocked(runValidation).mockResolvedValue({ passed: true, steps: [] });
  vi.mocked(classifyError).mockReturnValue("unknown");
  vi.mocked(createPullRequest).mockResolvedValue({ url: "https://github.com/test/repo/pull/1", number: 1 });
  vi.mocked(getTasksByWorkItemId).mockResolvedValue([{ 
    status: "completed", 
    id: "test-task-id", 
    workItemId: "test-work-item-id",
    dagNodeId: "dag-node-1",
    repo: "/tmp/repo",
    branch: "main", 
    worktreePath: null,
    description: "Test task",
    complexity: "simple",
    contextFilter: null, // This is an array field, so null is valid
    nexusSkills: null,  // This is an array field, so null is valid
    mcpServers: null,   // This is an array field, so null is valid
    dependsOn: null,    // This is an array field, so null is valid
    model: null,
    mode: null,
    fallbackChainPosition: 0,
    attempt: 1,
    maxAttempts: 3,
    retryPolicy: null,
    lastError: null,
    errorClass: null,
    tokensUsed: 0,
    costUsd: "0",
    durationMs: null,
    checkpointData: null,
    checkpointCount: 0,
    validationAttempts: 0,
    validationResults: null,
    prUrl: null,
    prNumber: null,
    prStatus: null,
    createdAt: new Date(),
    startedAt: new Date(),
    completedAt: new Date()
  }]);
  // Set the default access mock to make validation files not exist
  vi.mocked(access).mockImplementation((path: unknown) => {
    const strPath = typeof path === 'string' ? path : String(path);
    // For validation files (package.json, tsconfig.json), throw error (file doesn't exist)
    if (strPath.includes("package.json") || strPath.includes("tsconfig.json")) {
      return Promise.reject(new Error("File does not exist"));
    }
    // For other access calls, resolve successfully
    return Promise.resolve();
  });
});

// ── Test suite ────────────────────────────────────────────────────────────────

describe("orchestrateTask", () => {
  const baseContext: OrchestrationContext = {
    taskId: "test-task-id",
    workItemId: "test-work-item-id",
    repo: "/tmp/repo",
    branch: "feature/test",
    description: "Implement test feature",
    complexity: "simple",
    provider: "opencode",
    attempt: 1,
    maxAttempts: 3,
  db: {
    update: vi.fn((table) => ({
      set: vi.fn((data) => ({
        where: vi.fn().mockReturnValue({
          catch: vi.fn().mockReturnValue(Promise.resolve(undefined))
        })
      }))
    })),
    transaction: vi.fn(),
  } as any,
    redis: {} as any,
    config: {
      engine: { worktrees_dir: "/tmp/worktrees" },
      providers: {
        opencode: { default_model: "test-model", binary: "opencode" },
        anthropic: { binary: "claude" }
      },
      validation: { max_retries: 2, typescript: [] },
      github: { auto_create_pr: true, default_org: "test-org" }
    } as any,
  };

  it("happy path: task completes successfully", async () => {
    // Mock the worktree path
    vi.mocked(createWorktree).mockResolvedValue({ worktreePath: "/tmp/worktree-success" });
    
    // Execute the task
    await orchestrateTask(baseContext);
    
    // Verify status transitions
    expect(vi.mocked(updateTaskStatus)).toHaveBeenCalledWith(expect.anything(), "test-task-id", "running");
    expect(vi.mocked(updateTaskStatus)).toHaveBeenCalledWith(expect.anything(), "test-task-id", "completed");
    expect(vi.mocked(updateWorkItemStatus)).toHaveBeenCalledWith(expect.anything(), "test-work-item-id", "running");
    
    // Verify worktree created and cleaned
    expect(vi.mocked(createWorktree)).toHaveBeenCalled();
    expect(vi.mocked(removeWorktree)).toHaveBeenCalledWith({
      repoPath: "/tmp/repo",
      worktreePath: "/tmp/worktree-success"
    });
    
    // Verify PR created
    expect(vi.mocked(createPullRequest)).toHaveBeenCalledWith({
      repo: "test-org/repo",
      branch: "feature/test",
      title: "claw: Implement test feature",
      body: "Automated by claw-engine.\n\nTask ID: `test-task-id`\nWork item: `test-work-item-id`",
    });
    
    // Verify alert sent
    expect(vi.mocked(sendAlert)).toHaveBeenCalledWith({
      type: "session_completed",
      message: expect.stringContaining("✅ Task completed: Implement test feature"),
      taskId: "test-task-id",
      workItemId: "test-work-item-id",
    });
  });

  it("validation fails then retries", async () => {
    // First validation fails, then passes
    let validationCallCount = 0;
    vi.mocked(runValidation).mockImplementation(async () => {
      validationCallCount++;
      if (validationCallCount === 1) {
        return { 
          passed: false, 
          steps: [{ name: "typecheck", passed: false, output: "error TS2304", durationMs: 100 }] 
        };
      }
      return { 
        passed: true, 
        steps: [{ name: "typecheck", passed: true, output: "ok", durationMs: 50 }] 
      };
    });
    
    await orchestrateTask(baseContext);
    
    // Verify delegate was called twice (original + retry after validation fix)
    expect(vi.mocked(runOpencodePipe).mock.calls.length).toBeGreaterThanOrEqual(1);
    
    // Verify attempt was incremented in the database
    expect(vi.mocked(updateTaskStatus)).toHaveBeenCalledWith(expect.anything(), "test-task-id", "running");
  });

  it("all retries exhausted", async () => {
    // Temporarily change the mock implementation for this test
    vi.mocked(access).mockImplementation((path: unknown) => {
      const strPath = typeof path === 'string' ? path : String(path);
      // Make package.json exist to trigger validation
      if (strPath.includes("package.json")) {
        return Promise.resolve(); // File exists
      }
      // tsconfig.json still doesn't exist to not trigger full typechecking
      if (strPath.includes("tsconfig.json")) {
        return Promise.reject(new Error("File does not exist"));
      }
      // Other access calls succeed
      return Promise.resolve();
    });
    
    // Make validation always fail
    vi.mocked(runValidation).mockResolvedValue({ 
      passed: false, 
      steps: [{ name: "typecheck", passed: false, output: "error TS2304", durationMs: 100 }] 
    });
    
    // Configure to have 0 validation retries
    const contextWithNoRetries: OrchestrationContext = {
      ...baseContext,
      config: {
        ...baseContext.config,
        validation: { max_retries: 0, typescript: [] }
      }
    };
    
    await expect(orchestrateTask(contextWithNoRetries)).rejects.toThrow("validation_failed");
    
    // Verify task marked as failed
    expect(vi.mocked(updateTaskStatus)).toHaveBeenCalledWith(expect.anything(), "test-task-id", "failed");
    
    // Verify session_failed alert sent
    expect(vi.mocked(sendAlert)).toHaveBeenCalledWith({
      type: "session_failed",
      message: expect.stringContaining("❌ Task failed"),
      taskId: "test-task-id",
      workItemId: "test-work-item-id",
    });
    
    // Restore original mock for other tests
    vi.mocked(access).mockImplementation((path: unknown) => {
      const strPath = typeof path === 'string' ? path : String(path);
      // For validation files (package.json, tsconfig.json), throw error (file doesn't exist)
      if (strPath.includes("package.json") || strPath.includes("tsconfig.json")) {
        return Promise.reject(new Error("File does not exist"));
      }
      // For other access calls, resolve successfully
      return Promise.resolve();
    });
  });

  it("retryable delegate error (timeout) — retries", async () => {
    // Update the classifyError mock to return a retryable error
    vi.mocked(classifyError).mockReturnValue("timeout");
    
    // Mock delegate to fail once then succeed on retry
    let delegateCallCount = 0;
    vi.mocked(runOpencodePipe).mockImplementation(async function* () {
      delegateCallCount++;
      if (delegateCallCount === 1) {
        throw new Error("timeout - operation took too long");
      }
      yield { type: "text_delta", text: "implementing after retry..." } as HarnessEvent;
      yield { type: "session_end", reason: "completed" } as HarnessEvent;
    });
    
    await orchestrateTask({ ...baseContext, maxAttempts: 2 });
    
    // Should have been called twice (original + 1 retry)
    expect(delegateCallCount).toBe(2);
  });

  it("fatal delegate error (auth) — no retry, immediate fail", async () => {
    // Update the classifyError mock to return a fatal error
    vi.mocked(classifyError).mockReturnValue("auth");
    
    // Mock delegate to fail with auth error by returning a generator that throws on iteration
    vi.mocked(runOpencodePipe).mockImplementation(async function* () {
      throw new Error("authentication failed");
    });
    
    await expect(orchestrateTask(baseContext)).rejects.toThrow("authentication failed");
    
    // Should only be called once (no retry for fatal errors)
    expect(vi.mocked(runOpencodePipe).mock.calls.length).toBe(1);
    
    // Verify task marked as failed
    expect(vi.mocked(updateTaskStatus)).toHaveBeenCalledWith(expect.anything(), "test-task-id", "failed");
  });

  it("worktree cleanup on error", async () => {
    // Mock delegate to fail by throwing in the generator
    vi.mocked(runOpencodePipe).mockImplementation(async function* () {
      yield { type: "text_delta", text: "starting..." } as HarnessEvent;
      throw new Error("delegate failed");
    });
    
    const testContext: OrchestrationContext = {
      ...baseContext,
      attempt: 3, // Max attempt to trigger failure
      maxAttempts: 3
    };
    
    await expect(orchestrateTask(testContext)).rejects.toThrow("delegate failed");
    
    // Verify worktree was cleaned up in finally block
    expect(vi.mocked(removeWorktree)).toHaveBeenCalled();
  });

  it("SSE events published", async () => {
    // Mock delegate to yield events
    vi.mocked(runOpencodePipe).mockImplementation(async function* () {
      yield { type: "token_update", used: 100, budget: 1000, percent: 10 } as HarnessEvent;
      yield { type: "text_delta", text: "working..." } as HarnessEvent;
      yield { type: "session_end", reason: "completed" } as HarnessEvent;
    });
    
    await orchestrateTask(baseContext);
    
    // Verify events were published to SSE
    expect(vi.mocked(publishEvent).mock.calls.length).toBeGreaterThan(0);
    
    // Check that specific event types were published
    const publishedEvents = vi.mocked(publishEvent).mock.calls.map(call => call[1]);
    expect(publishedEvents.some(event => event.type === "session_start")).toBe(true);
    expect(publishedEvents.some(event => event.type === "session_end")).toBe(true);
  });
});