import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { enterWorktreeTool, exitWorktreeTool } from "../../../src/harness/tools/builtins/worktree.js";
import { createWorktree, removeWorktree } from "../../../src/integrations/git/worktrees.js";
import { join } from "node:path";

vi.mock("../../../src/integrations/git/worktrees.js", () => ({
  createWorktree: vi.fn(),
  removeWorktree: vi.fn(),
}));

describe("Worktree Tools", () => {
  const originalWorkspacePath = "/tmp/test-project";
  const worktreePath = "/tmp/test-project/.worktrees/test-feature";
  
  const mockContext = {
    workspacePath: originalWorkspacePath,
    sessionId: "session-test-123",
    workItemId: "workitem-test-abc",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset any extended properties on the context
    delete (mockContext as any)._originalWorkspacePath;
  });

  describe("enter_worktree", () => {
    it("should create a worktree with minimal input", async () => {
      vi.mocked(createWorktree).mockResolvedValue({ worktreePath });

      const result = await enterWorktreeTool.execute(
        { name: "test-feature" },
        { ...mockContext }
      );

      expect(result.isError).toBe(false);
      expect(JSON.parse(result.output)).toEqual({
        worktreePath,
        originalPath: originalWorkspacePath,
      });
      expect(vi.mocked(createWorktree).mock.calls[0][0]).toEqual({
        repoPath: originalWorkspacePath,
        worktreesDir: join(originalWorkspacePath, ".worktrees"),
        taskId: "test-feature",
        branch: "test-feature",
      });
    });

    it("should create a worktree with custom branch name", async () => {
      vi.mocked(createWorktree).mockResolvedValue({ worktreePath });

      const result = await enterWorktreeTool.execute(
        { name: "test-wt", branch: "feature/new-ui" },
        { ...mockContext }
      );

      expect(result.isError).toBe(false);
      expect(vi.mocked(createWorktree).mock.calls[0][0]).toEqual({
        repoPath: originalWorkspacePath,
        worktreesDir: join(originalWorkspacePath, ".worktrees"),
        taskId: "test-wt",
        branch: "feature/new-ui",
      });
    });

    it("should create a worktree with custom repo path", async () => {
      vi.mocked(createWorktree).mockResolvedValue({ worktreePath });

      const customRepoPath = "/tmp/custom-repo";
      const result = await enterWorktreeTool.execute(
        { name: "custom-wt", repo: customRepoPath },
        { ...mockContext }
      );

      expect(result.isError).toBe(false);
      expect(vi.mocked(createWorktree).mock.calls[0][0]).toEqual({
        repoPath: customRepoPath,
        worktreesDir: join(customRepoPath, ".worktrees"),
        taskId: "custom-wt",
        branch: "custom-wt",
      });
    });

    it("should return error for invalid input", async () => {
      const result = await enterWorktreeTool.execute(
        { branch: "test" },
        { ...mockContext }
      );

      expect(result.isError).toBe(true);
      expect(result.output).toContain("invalid input");
    });

    it("should return error when createWorktree fails", async () => {
      vi.mocked(createWorktree).mockRejectedValue(new Error("Git error"));

      const result = await enterWorktreeTool.execute(
        { name: "failing-wt" },
        { ...mockContext }
      );

      expect(result.isError).toBe(true);
      expect(result.output).toBe("Git error");
    });

    it("should update context workspacePath after successful creation", async () => {
      vi.mocked(createWorktree).mockResolvedValue({ worktreePath });

      const contextCopy = { ...mockContext };
      await enterWorktreeTool.execute({ name: "test-wt" }, contextCopy);

      expect(contextCopy.workspacePath).toBe(worktreePath);
      expect((contextCopy as any)._originalWorkspacePath).toBe(originalWorkspacePath);
    });
  });

  describe("exit_worktree", () => {
    beforeEach(() => {
      // Setup context with worktree state
      (mockContext as any)._originalWorkspacePath = originalWorkspacePath;
      mockContext.workspacePath = worktreePath;
    });

    it("should restore original workspace path with action=keep", async () => {
      const result = await exitWorktreeTool.execute(
        { action: "keep" },
        { ...mockContext }
      );

      expect(result.isError).toBe(false);
      expect(JSON.parse(result.output)).toEqual({
        restoredPath: originalWorkspacePath,
        action: "keep",
      });
      expect(removeWorktree).not.toHaveBeenCalled();
    });

    it("should restore original workspace path and remove worktree with action=remove", async () => {
      const result = await exitWorktreeTool.execute(
        { action: "remove" },
        { ...mockContext }
      );

      expect(result.isError).toBe(false);
      expect(JSON.parse(result.output)).toEqual({
        restoredPath: originalWorkspacePath,
        action: "remove",
      });
      expect(removeWorktree).toHaveBeenCalledWith({
        repoPath: originalWorkspacePath,
        worktreePath,
      });
    });

    it("should return error for invalid action", async () => {
      const result = await exitWorktreeTool.execute(
        { action: "invalid" },
        { ...mockContext }
      );

      expect(result.isError).toBe(true);
      expect(result.output).toContain("invalid input");
    });

    it("should return error when no worktree session exists", async () => {
      // Context without _originalWorkspacePath
      const contextWithoutWorktree = {
        workspacePath: originalWorkspacePath,
        sessionId: "session-test-123",
        workItemId: "workitem-test-abc",
      };

      const result = await exitWorktreeTool.execute(
        { action: "keep" },
        contextWithoutWorktree
      );

      expect(result.isError).toBe(true);
      expect(result.output).toContain("no active worktree");
    });

    it("should return error when removeWorktree fails", async () => {
      vi.mocked(removeWorktree).mockRejectedValue(new Error("Remove failed"));

      const result = await exitWorktreeTool.execute(
        { action: "remove" },
        { ...mockContext }
      );

      expect(result.isError).toBe(true);
      expect(result.output).toBe("Remove failed");
    });

    it("should restore context workspacePath after successful exit", async () => {
      const contextCopy = {
        ...mockContext,
        workspacePath: worktreePath,
        _originalWorkspacePath: originalWorkspacePath,
      };

      await exitWorktreeTool.execute({ action: "keep" }, contextCopy);

      expect(contextCopy.workspacePath).toBe(originalWorkspacePath);
      expect((contextCopy as any)._originalWorkspacePath).toBeUndefined();
    });
  });
});