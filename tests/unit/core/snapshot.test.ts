import { describe, it, beforeEach, afterEach, vi, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync } from "node:fs";
import {
  createSnapshot,
  restoreSnapshot,
  cleanupSnapshot,
} from "../../../src/core/snapshot.js";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => true),
  lstatSync: vi.fn(() => ({ isDirectory: () => true })),
}));

describe("snapshot", () => {
  const mockRepoPath = "/tmp/test-repo";

  beforeEach(() => {
    vi.clearAllMocks();
    (execFileSync as any).mockReturnValue("");
    (existsSync as any).mockReturnValue(true);
    (lstatSync as any).mockReturnValue({ isDirectory: () => true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("createSnapshot", () => {
    it("creates a git tag with timestamp using execFileSync", () => {
      const timestamp = Date.now();
      vi.useFakeTimers();
      vi.setSystemTime(timestamp);

      const result = createSnapshot({ repoPath: mockRepoPath });

      expect(result).toBe(`claw-snapshot-${timestamp}`);
      expect(execFileSync).toHaveBeenCalledWith(
        "git",
        ["tag", `claw-snapshot-${timestamp}`, "HEAD"],
        expect.objectContaining({ cwd: expect.any(String), encoding: "utf-8" }),
      );

      vi.useRealTimers();
    });
  });

  describe("restoreSnapshot", () => {
    it("restores using execFileSync with array args", () => {
      const mockRef = "claw-snapshot-12345";

      restoreSnapshot({ repoPath: mockRepoPath, ref: mockRef });

      expect(execFileSync).toHaveBeenCalledWith(
        "git",
        ["reset", "--hard", mockRef],
        expect.objectContaining({ cwd: expect.any(String) }),
      );
      expect(execFileSync).toHaveBeenCalledWith(
        "git",
        ["clean", "-fd"],
        expect.objectContaining({ cwd: expect.any(String) }),
      );
    });

    it("rejects invalid ref patterns", () => {
      expect(() => {
        restoreSnapshot({ repoPath: mockRepoPath, ref: "HEAD; rm -rf /" });
      }).toThrow("Invalid snapshot ref");
    });

    it("rejects refs without claw-snapshot prefix", () => {
      expect(() => {
        restoreSnapshot({ repoPath: mockRepoPath, ref: "some-other-tag" });
      }).toThrow("Invalid snapshot ref");
    });
  });

  describe("cleanupSnapshot", () => {
    it("removes the git tag using execFileSync", () => {
      const mockRef = "claw-snapshot-12345";

      cleanupSnapshot({ repoPath: mockRepoPath, ref: mockRef });

      expect(execFileSync).toHaveBeenCalledWith(
        "git",
        ["tag", "-d", mockRef],
        expect.objectContaining({ cwd: expect.any(String) }),
      );
    });

    it("is idempotent — does not throw on already-deleted tag", () => {
      (execFileSync as any).mockImplementation(() => {
        throw new Error("Tag doesn't exist");
      });

      expect(() => {
        cleanupSnapshot({ repoPath: mockRepoPath, ref: "claw-snapshot-99999" });
      }).not.toThrow();
    });

    it("rejects invalid refs silently", () => {
      expect(() => {
        cleanupSnapshot({ repoPath: mockRepoPath, ref: "invalid-tag" });
      }).not.toThrow();
      // Should not call execFileSync because ref validation fails first
      expect(execFileSync).not.toHaveBeenCalled();
    });
  });
});
