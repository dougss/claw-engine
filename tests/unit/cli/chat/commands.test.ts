import { describe, it, expect } from "vitest";
import {
  parseSlashCommand,
  SLASH_COMMANDS,
} from "../../../../src/cli/chat/commands.js";

describe("slash commands", () => {
  it("parses /exit", () => {
    const cmd = parseSlashCommand("/exit");
    expect(cmd).toEqual({ name: "exit", args: [] });
  });

  it("parses /model with argument", () => {
    const cmd = parseSlashCommand("/model qwen3-coder-plus");
    expect(cmd).toEqual({ name: "model", args: ["qwen3-coder-plus"] });
  });

  it("parses /resume with id", () => {
    const cmd = parseSlashCommand("/resume abc-123-def");
    expect(cmd).toEqual({ name: "resume", args: ["abc-123-def"] });
  });

  it("returns null for unknown command", () => {
    const cmd = parseSlashCommand("/unknown");
    expect(cmd).toBeNull();
  });

  it("returns null for non-slash input", () => {
    const cmd = parseSlashCommand("fix the bug");
    expect(cmd).toBeNull();
  });

  it("parses /pipeline with no args", () => {
    const cmd = parseSlashCommand("/pipeline");
    expect(cmd).toEqual({ name: "pipeline", args: [] });
  });

  it("parses /delegate with no args", () => {
    const cmd = parseSlashCommand("/delegate");
    expect(cmd).toEqual({ name: "delegate", args: [] });
  });

  it("SLASH_COMMANDS has help text for all commands", () => {
    const names = Object.keys(SLASH_COMMANDS);
    expect(names).toContain("exit");
    expect(names).toContain("status");
    expect(names).toContain("model");
    expect(names).toContain("delegate");
    expect(names).toContain("pipeline");
    expect(names).toContain("clear");
    expect(names).toContain("resume");
    expect(names).toContain("help");
  });
});