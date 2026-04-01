import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../../../src/harness/context-builder.js";
import type { Message, ToolDefinition } from "../../../src/types.js";

function readFixture(name: string): string {
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  const fixturePath = path.resolve(dirname, "../../fixtures", name);
  return readFileSync(fixturePath, "utf8");
}

describe("context builder", () => {
  it("includes identity layer", () => {
    const prompt = buildSystemPrompt({
      task: {
        description: "Do the thing",
        contextFilter: [],
        nexusSkills: [],
      },
      tools: [],
      projectContext: "line1\nline2",
    });

    expect(prompt).toContain("IDENTITY");
    expect(prompt).toContain("You are a coding agent");
  });

  it("includes tool schemas", () => {
    const tools: ToolDefinition[] = [
      {
        name: "doStuff",
        description: "Does stuff",
        inputSchema: { type: "object", properties: { a: { type: "string" } } },
      },
    ];

    const prompt = buildSystemPrompt({
      task: {
        description: "Use tools",
        contextFilter: [],
        nexusSkills: [],
      },
      tools,
      projectContext: "x",
    });

    expect(prompt).toContain("TOOLS");
    expect(prompt).toContain('"name": "doStuff"');
    expect(prompt).toContain('"inputSchema"');
    expect(prompt).toContain('"properties"');
  });

  it("filters CLAUDE.md by headings for contextFilter", () => {
    const projectContext = readFixture("sample-claude.md");

    const prompt = buildSystemPrompt({
      task: {
        description: "Filter headings",
        contextFilter: ["segurança — regras"],
        nexusSkills: [],
      },
      tools: [],
      projectContext,
    });

    expect(prompt).toContain("PROJECT CONTEXT");
    expect(prompt).toContain("## Segurança — REGRAS");
    expect(prompt).toContain("1. SSH: Key-only");
    expect(prompt).not.toContain("## Infraestrutura do Servidor");
  });

  it("falls back to first 50 lines when no match", () => {
    const projectContext = Array.from(
      { length: 80 },
      (_, i) => `line-${i + 1}`,
    ).join("\n");

    const prompt = buildSystemPrompt({
      task: {
        description: "No match",
        contextFilter: ["does-not-exist"],
        nexusSkills: [],
      },
      tools: [],
      projectContext,
    });

    expect(prompt).toContain("line-1");
    expect(prompt).toContain("line-50");
    expect(prompt).not.toContain("line-51");
  });

  it("includes checkpoint summary + recent messages when provided", () => {
    const recentMessages: Message[] = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ];

    const prompt = buildSystemPrompt({
      task: {
        description: "Resume",
        contextFilter: [],
        nexusSkills: ["nexus"],
      },
      tools: [],
      projectContext: "ctx",
      checkpoint: {
        summary: "We were doing X",
        recentMessages,
      },
    });

    expect(prompt).toContain("CHECKPOINT");
    expect(prompt).toContain("We were doing X");
    expect(prompt).toContain('"role": "user"');
    expect(prompt).toContain('"content": "hello"');
  });
});
