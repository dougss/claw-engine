import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runSingleSession } from "../../src/core/session-manager.js";
import {
  createWorktree,
  removeWorktree,
} from "../../src/integrations/git/worktrees.js";
import { createMockAdapter } from "../../src/harness/model-adapters/mock-adapter.js";

function execFileAsync({
  command,
  args,
  cwd,
}: {
  command: string;
  args: string[];
  cwd?: string;
}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd }, (error, stdout, stderr) => {
      if (error) {
        reject(
          new Error(`${command} ${args.join(" ")} failed: ${stderr || error}`),
        );
        return;
      }

      resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
  });
}

async function initCommittedRepo(repoPath: string): Promise<void> {
  await mkdir(repoPath, { recursive: true });

  await execFileAsync({ command: "git", args: ["init"], cwd: repoPath });

  await writeFile(join(repoPath, "README.md"), "temp repo\n");

  await execFileAsync({ command: "git", args: ["add", "."], cwd: repoPath });

  await execFileAsync({
    command: "git",
    args: [
      "-c",
      "user.name=claw-engine-test",
      "-c",
      "user.email=claw-engine-test@example.com",
      "commit",
      "-m",
      "init",
    ],
    cwd: repoPath,
  });
}

describe("session-manager + worktree provisioning", () => {
  it("provisions a worktree and completes a single mock session", async () => {
    const baseDir = join(
      tmpdir(),
      `claw-engine-it-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    const repoPath = join(baseDir, "repo");
    const worktreesDir = join(baseDir, "worktrees");

    await mkdir(baseDir, { recursive: true });
    await initCommittedRepo(repoPath);

    let worktreePath: string | null = null;

    try {
      const created = await createWorktree({
        repoPath,
        worktreesDir,
        taskId: "task-10-it",
        branch: "task-10-it-branch",
      });

      worktreePath = created.worktreePath;

      const adapter = createMockAdapter({
        name: "mock-text-only",
        responses: [[{ type: "text_delta", text: "ok" }]],
      });

      const result = await runSingleSession({
        adapter,
        systemPrompt: "You are a test runner.",
        userPrompt: "Say ok.",
        tools: [],
        workspacePath: worktreePath,
        maxIterations: 3,
      });

      expect(result.endReason).toBe("completed");
      expect(result.events.some((e) => e.type === "session_end")).toBe(true);
    } finally {
      if (worktreePath) {
        await removeWorktree({ repoPath, worktreePath });
      }
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it("uses QueryEnginePort for session orchestration", async () => {
    const baseDir = join(
      tmpdir(),
      `claw-engine-qep-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    const repoPath = join(baseDir, "repo");

    await mkdir(baseDir, { recursive: true });
    await initCommittedRepo(repoPath);

    try {
      const adapter = createMockAdapter({
        name: "mock-qep",
        responses: [[{ type: "text_delta", text: "completed via QEP" }]],
      });

      const result = await runSingleSession({
        adapter,
        systemPrompt: "You are a test runner.",
        userPrompt: "Say hello.",
        tools: [],
        workspacePath: repoPath,
        maxIterations: 3,
      });

      expect(result.endReason).toBe("completed");
      expect(result.events.some((e) => e.type === "session_end")).toBe(true);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });
});
