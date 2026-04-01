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
});
