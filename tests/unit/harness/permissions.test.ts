import { describe, expect, it } from "vitest";
import {
  DEFAULT_PERMISSION_RULES,
  evaluatePermission,
} from "../../../src/harness/permissions.js";

describe("permissions", () => {
  it("read-only tools always allow", () => {
    expect(
      evaluatePermission({
        tool: "read_file",
        input: { path: "/etc/hosts" },
        workspacePath: "/ws",
        rules: DEFAULT_PERMISSION_RULES,
      }).action,
    ).toBe("allow");

    expect(
      evaluatePermission({
        tool: "glob",
        input: { pattern: "**/*.ts" },
        workspacePath: "/ws",
        rules: DEFAULT_PERMISSION_RULES,
      }).action,
    ).toBe("allow");

    expect(
      evaluatePermission({
        tool: "grep",
        input: { pattern: "foo" },
        workspacePath: "/ws",
        rules: DEFAULT_PERMISSION_RULES,
      }).action,
    ).toBe("allow");
  });

  it("ask_user is allowed", () => {
    expect(
      evaluatePermission({
        tool: "ask_user",
        input: { question: "ok?" },
        workspacePath: "/ws",
        rules: DEFAULT_PERMISSION_RULES,
      }).action,
    ).toBe("allow");
  });

  it("write/edit allow inside workspace, deny outside", () => {
    expect(
      evaluatePermission({
        tool: "write_file",
        input: { path: "/ws/a.txt", content: "x" },
        workspacePath: "/ws",
        rules: DEFAULT_PERMISSION_RULES,
      }).action,
    ).toBe("allow");

    expect(
      evaluatePermission({
        tool: "edit_file",
        input: { path: "/ws/sub/b.txt", content: "y" },
        workspacePath: "/ws",
        rules: DEFAULT_PERMISSION_RULES,
      }).action,
    ).toBe("allow");

    expect(
      evaluatePermission({
        tool: "write_file",
        input: { path: "/etc/passwd", content: "nope" },
        workspacePath: "/ws",
        rules: DEFAULT_PERMISSION_RULES,
      }).action,
    ).toBe("deny");

    expect(
      evaluatePermission({
        tool: "edit_file",
        input: { path: "/outside/file.txt", content: "nope" },
        workspacePath: "/ws",
        rules: DEFAULT_PERMISSION_RULES,
      }).action,
    ).toBe("deny");
  });

  it("bash allows safe commands, denies destructive patterns", () => {
    expect(
      evaluatePermission({
        tool: "bash",
        input: { command: "echo hello" },
        workspacePath: "/ws",
        rules: DEFAULT_PERMISSION_RULES,
      }).action,
    ).toBe("allow");

    expect(
      evaluatePermission({
        tool: "bash",
        input: { command: "rm -rf /" },
        workspacePath: "/ws",
        rules: DEFAULT_PERMISSION_RULES,
      }).action,
    ).toBe("deny");

    expect(
      evaluatePermission({
        tool: "bash",
        input: { command: "git push --force origin main" },
        workspacePath: "/ws",
        rules: DEFAULT_PERMISSION_RULES,
      }).action,
    ).toBe("deny");

    expect(
      evaluatePermission({
        tool: "bash",
        input: { command: 'psql -c "drop database prod" ' },
        workspacePath: "/ws",
        rules: DEFAULT_PERMISSION_RULES,
      }).action,
    ).toBe("deny");

    expect(
      evaluatePermission({
        tool: "bash",
        input: { command: "mkfs.ext4 /dev/sda1" },
        workspacePath: "/ws",
        rules: DEFAULT_PERMISSION_RULES,
      }).action,
    ).toBe("deny");
  });
});
