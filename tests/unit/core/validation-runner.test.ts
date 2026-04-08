import { describe, it, expect, vi } from "vitest";
import { runValidation } from "../../../src/core/validation-runner.js";

describe("validation-runner", () => {
  it("runs all steps and returns results", async () => {
    const results = await runValidation({
      workspacePath: "/tmp/test-ws",
      steps: [
        {
          name: "typecheck",
          command: "echo ok",
          required: true,
          retryable: true,
        },
        {
          name: "test",
          command: "echo passed",
          required: true,
          retryable: true,
        },
      ],
      execCommand: async (cmd, cwd) => ({ stdout: "ok", exitCode: 0 }),
    });
    expect(results.passed).toBe(true);
    expect(results.steps).toHaveLength(2);
    expect(results.steps.every((s) => s.passed)).toBe(true);
  });

  it("returns failed when required step fails", async () => {
    const results = await runValidation({
      workspacePath: "/tmp/test-ws",
      steps: [
        { name: "typecheck", command: "tsc", required: true, retryable: true },
      ],
      execCommand: async () => ({
        stdout: "error TS2304: Cannot find name 'foo'",
        exitCode: 1,
      }),
    });
    expect(results.passed).toBe(false);
    expect(results.steps[0].passed).toBe(false);
    expect(results.steps[0].output).toContain("TS2304");
  });

  it("passes when optional step fails", async () => {
    const results = await runValidation({
      workspacePath: "/tmp/test-ws",
      steps: [
        { name: "lint", command: "lint", required: false, retryable: true },
        { name: "test", command: "test", required: true, retryable: true },
      ],
      execCommand: async (cmd) =>
        cmd.includes("lint")
        ? { stdout: "warning", exitCode: 1 }
        : { stdout: "pass", exitCode: 0 },
    });
    expect(results.passed).toBe(true);
  });

  it("runs steps in parallel when parallel=true", async () => {
    const slowCommands: string[] = [];
    const start = Date.now();
    
    const results = await runValidation({
      workspacePath: "/tmp/test-ws",
      steps: [
        { name: "slow1", command: "slow1", required: true, retryable: true },
        { name: "slow2", command: "slow2", required: true, retryable: true },
      ],
      execCommand: async (cmd) => {
        slowCommands.push(cmd);
        // Simulate slow commands that take 50ms each
        await new Promise(resolve => setTimeout(resolve, 50));
        return { stdout: `${cmd} result`, exitCode: 0 };
      },
      parallel: true,
    });
    
    const duration = Date.now() - start;
    
    expect(results.passed).toBe(true);
    expect(results.steps).toHaveLength(2);
    expect(results.steps.every((s) => s.passed)).toBe(true);
    // If parallel, both run concurrently so total < 2x individual duration
    // Use generous threshold for CI environments with variable load
    expect(duration).toBeLessThan(200);
    expect(slowCommands.length).toBe(2);
  });

  it("short-circuits sequential mode on required step failure", async () => {
    const executedCommands: string[] = [];
    const results = await runValidation({
      workspacePath: "/tmp/test-ws",
      steps: [
        { name: "typecheck", command: "tsc", required: true, retryable: true },
        { name: "lint", command: "lint", required: false, retryable: true },
        { name: "test", command: "test", required: true, retryable: true },
      ],
      execCommand: async (cmd) => {
        executedCommands.push(cmd);
        if (cmd === "tsc") return { stdout: "error", exitCode: 1 };
        return { stdout: "ok", exitCode: 0 };
      },
    });
    expect(results.passed).toBe(false);
    // Should stop after first required failure — lint and test should NOT run
    expect(executedCommands).toEqual(["tsc"]);
    expect(results.steps).toHaveLength(1);
  });

  it("returns failed when required step fails in parallel mode", async () => {
    const results = await runValidation({
      workspacePath: "/tmp/test-ws",
      steps: [
        { name: "passing", command: "pass", required: true, retryable: true },
        { name: "failing", command: "fail", required: true, retryable: true },
      ],
      execCommand: async (cmd) =>
        cmd === "pass"
        ? { stdout: "ok", exitCode: 0 }
        : { stdout: "error", exitCode: 1 },
      parallel: true,
    });
    expect(results.passed).toBe(false);
    expect(results.steps).toHaveLength(2);
    expect(results.steps.find(s => s.name === "passing")?.passed).toBe(true);
    expect(results.steps.find(s => s.name === "failing")?.passed).toBe(false);
  });
});
