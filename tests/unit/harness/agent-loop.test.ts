import { describe, it, expect } from "vitest";
import { createMockAdapter } from "../../../src/harness/model-adapters/mock-adapter.js";
import { runAgentLoop } from "../../../src/harness/agent-loop.js";
import type { ToolHandler } from "../../../src/harness/tools/tool-types.js";

describe("runAgentLoop", () => {
  it("completes when model returns only text_delta", async () => {
    const adapter = createMockAdapter({
      name: "test-mock",
      responses: [[{ type: "text_delta", text: "Hello" }]],
    });

    const events: unknown[] = [];
    for await (const e of runAgentLoop({
      adapter,
      systemPrompt: "sys",
      userPrompt: "user",
      tools: [],
      maxIterations: 3,
      tokenBudget: 1000,
      workspacePath: "/tmp",
    })) {
      events.push(e);
    }

    expect(events).toEqual([
      { type: "text_delta", text: "Hello" },
      { type: "session_end", reason: "completed" },
    ]);
  });

  it("executes a tool call and yields tool_result", async () => {
    const adapter = createMockAdapter({
      name: "test-mock",
      responses: [
        [
          {
            type: "tool_use",
            id: "t1",
            name: "echo",
            input: { text: "hi" },
          },
        ],
        [{ type: "text_delta", text: "Done" }],
      ],
    });

    const echoTool: ToolHandler = {
      name: "echo",
      description: "Echo input",
      inputSchema: {},
      async execute(input) {
        return { output: JSON.stringify(input), isError: false };
      },
    };

    const toolHandlers = new Map<string, ToolHandler>([["echo", echoTool]]);

    const events: unknown[] = [];
    for await (const e of runAgentLoop({
      adapter,
      systemPrompt: "sys",
      userPrompt: "user",
      tools: [],
      maxIterations: 3,
      tokenBudget: 1000,
      workspacePath: "/tmp",
      toolHandlers,
    })) {
      events.push(e);
    }

    expect(events).toEqual([
      { type: "tool_use", id: "t1", name: "echo", input: { text: "hi" } },
      {
        type: "tool_result",
        id: "t1",
        output: '{"text":"hi"}',
        isError: false,
      },
      { type: "text_delta", text: "Done" },
      { type: "session_end", reason: "completed" },
    ]);
  });

  it("stops at maxIterations", async () => {
    const adapter = createMockAdapter({
      name: "test-mock",
      responses: [
        [
          {
            type: "tool_use",
            id: "t1",
            name: "echo",
            input: { n: 1 },
          },
        ],
      ],
    });

    const echoTool: ToolHandler = {
      name: "echo",
      description: "Echo input",
      inputSchema: {},
      async execute(input) {
        return { output: JSON.stringify(input), isError: false };
      },
    };

    const toolHandlers = new Map<string, ToolHandler>([["echo", echoTool]]);

    const events: unknown[] = [];
    for await (const e of runAgentLoop({
      adapter,
      systemPrompt: "sys",
      userPrompt: "user",
      tools: [],
      maxIterations: 1,
      tokenBudget: 1000,
      workspacePath: "/tmp",
      toolHandlers,
    })) {
      events.push(e);
    }

    expect(events).toEqual([
      { type: "tool_use", id: "t1", name: "echo", input: { n: 1 } },
      { type: "tool_result", id: "t1", output: '{"n":1}', isError: false },
      { type: "session_end", reason: "max_iterations" },
    ]);
  });
});
