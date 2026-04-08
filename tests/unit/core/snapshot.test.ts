import { describe, it, beforeEach, afterEach, vi, expect } from "vitest";
import { execSync } from "node:child_process";
import {
  createSnapshot,
  restoreSnapshot,
  cleanupSnapshot,
} from "../../../src/core/snapshot.js";

// Mock node:child_process
vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

describe("snapshot", () => {
  const mockRepoPath = "/tmp/test-repo";

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock execSync to return something reasonable for git commands
    (execSync as any).mockImplementation((command: string) => {
      if (command.startsWith("git tag claw-snapshot-")) {
        return ""; // Success
      }
      return "";
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("createSnapshot", () => {
    it("creates a git tag with timestamp", () => {
      const timestamp = Date.now();
      vi.useFakeTimers();
      vi.setSystemTime(timestamp);

      createSnapshot({ repoPath: mockRepoPath });

      expect(execSync).toHaveBeenCalledWith(
        `git tag claw-snapshot-${timestamp} HEAD`,
        {
          cwd: mockRepoPath,
          encoding: "utf-8",
          timeout: 300_000,
        }
      );

      vi.useRealTimers();
    });

    it("returns the created tag name", () => {
      const timestamp = Date.now();
      vi.useFakeTimers();
      vi.setSystemTime(timestamp);

      const result = createSnapshot({ repoPath: mockRepoPath });

      expect(result).toBe(`claw-snapshot-${timestamp}`);

      vi.useRealTimers();
    });
  });

  describe("restoreSnapshot", () => {
    it("restores to the provided reference with checkout, clean, and reset", () => {
      const mockRef = "claw-snapshot-12345";
      
      restoreSnapshot({ repoPath: mockRepoPath, ref: mockRef });

      // Should call git reset and git clean in sequence
      expect(execSync).toHaveBeenNthCalledWith(
        1,
        `git reset --hard ${mockRef}`,
        {
          cwd: mockRepoPath,
          encoding: "utf-8",
          timeout: 300_000,
        }
      );
      expect(execSync).toHaveBeenNthCalledWith(
        2,
        "git clean -fd",
        {
          cwd: mockRepoPath,
          encoding: "utf-8",
          timeout: 300_000,
        }
      );
    });
  });

  describe("cleanupSnapshot", () => {
    it("removes the git tag", () => {
      const mockRef = "claw-snapshot-12345";
      
      cleanupSnapshot({ repoPath: mockRepoPath, ref: mockRef });

      expect(execSync).toHaveBeenCalledWith(
        `git tag -d ${mockRef}`,
        {
          cwd: mockRepoPath,
          encoding: "utf-8",
          timeout: 300_000,
        }
      );
    });

    it("handles errors gracefully", () => {
      (execSync as any).mockImplementation(() => {
        throw new Error("Tag doesn't exist");
      });

      // Should not throw an error even if git command fails
      expect(() => {
        cleanupSnapshot({ repoPath: mockRepoPath, ref: "invalid-tag" });
      }).not.toThrow();

      expect(execSync).toHaveBeenCalledWith(
        `git tag -d invalid-tag`,
        {
          cwd: mockRepoPath,
          encoding: "utf-8",
          timeout: 300_000,
        }
      );
    });
  });
});