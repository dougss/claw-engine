import { describe, it, expect } from "vitest";
import {
  runDoctorChecks,
  type DoctorCheck,
} from "../../../src/cli/commands/doctor.js";

describe("doctor command", () => {
  it("returns check results for each item", async () => {
    const checks = await runDoctorChecks({
      checkConfig: async () => ({
        name: "config",
        passed: true,
        message: "Config valid",
      }),
      checkDb: async () => ({
        name: "database",
        passed: true,
        message: "Connected",
      }),
      checkRedis: async () => ({
        name: "redis",
        passed: true,
        message: "Connected",
      }),
      checkClaude: async () => ({
        name: "claude binary",
        passed: true,
        message: "Found at /usr/bin/claude",
      }),
    });

    expect(checks).toHaveLength(4);
    expect(checks.every((c) => c.passed)).toBe(true);
  });

  it("reports failed checks", async () => {
    const checks = await runDoctorChecks({
      checkConfig: async () => ({
        name: "config",
        passed: true,
        message: "OK",
      }),
      checkDb: async () => ({
        name: "database",
        passed: false,
        message: "Connection refused",
      }),
      checkRedis: async () => ({ name: "redis", passed: true, message: "OK" }),
      checkClaude: async () => ({
        name: "claude binary",
        passed: true,
        message: "Found",
      }),
    });

    const dbCheck = checks.find((c) => c.name === "database");
    expect(dbCheck?.passed).toBe(false);
    expect(dbCheck?.message).toContain("refused");
  });

  it("overall passes only when all required checks pass", async () => {
    const checks = await runDoctorChecks({
      checkConfig: async () => ({
        name: "config",
        passed: true,
        message: "OK",
      }),
      checkDb: async () => ({
        name: "database",
        passed: false,
        message: "Error",
      }),
      checkRedis: async () => ({
        name: "redis",
        passed: false,
        message: "Error",
      }),
      checkClaude: async () => ({
        name: "claude binary",
        passed: true,
        message: "OK",
      }),
    });

    const allPassed = checks.every((c) => c.passed);
    expect(allPassed).toBe(false);
  });
});
