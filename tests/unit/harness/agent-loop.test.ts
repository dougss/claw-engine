import { describe, it, expect } from "vitest";
import { createMockAdapter } from "../../../src/harness/model-adapters/mock-adapter.js";
import { runAgentLoop } from "../../../src/harness/agent-loop.js";
import type { ToolHandler } from "../../../src/harness/tools/tool-types.js";
import { PERMISSION_ACTION } from "../../../src/harness/permissions.js";
import { clearRegistry, registerMcpTools } from "../../../src/harness/tools/tool-registry.js";

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
      permissionRules: [{ tool: "echo", action: PERMISSION_ACTION.allow }],
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
      permissionRules: [{ tool: "echo", action: PERMISSION_ACTION.allow }],
    })) {
      events.push(e);
    }

    expect(events).toEqual([
      { type: "tool_use", id: "t1", name: "echo", input: { n: 1 } },
      { type: "tool_result", id: "t1", output: '{"n":1}', isError: false },
      { type: "session_end", reason: "max_iterations" },
    ]);
  });

  it("executes concurrency-safe tools in parallel", async () => {
    const adapter = createMockAdapter({
      name: "test-mock",
      responses: [
        [
          {
            type: "tool_use",
            id: "t1",
            name: "read_file",
            input: { path: "file1.txt" },
          },
          {
            type: "tool_use",
            id: "t2",
            name: "grep",
            input: { pattern: "test", path: "." },
          },
          {
            type: "tool_use",
            id: "t3",
            name: "glob",
            input: { pattern: "*.txt" },
          },
        ],
        [{ type: "text_delta", text: "Completed" }],
      ],
    });

    const readFileSync = { name: "read_file", isConcurrencySafe: true, description: "Read file", inputSchema: {}, execute: async (_input: unknown) => ({ output: "file content", isError: false }) };
    const grepSync = { name: "grep", isConcurrencySafe: true, description: "Grep", inputSchema: {}, execute: async (_input: unknown) => ({ output: "grep result", isError: false }) };
    const globSync = { name: "glob", isConcurrencySafe: true, description: "Glob", inputSchema: {}, execute: async (_input: unknown) => ({ output: "glob result", isError: false }) };

    const toolHandlers = new Map<string, ToolHandler>([
      ["read_file", readFileSync],
      ["grep", grepSync], 
      ["glob", globSync],
    ]);

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
      permissionRules: [
        { tool: "read_file", action: PERMISSION_ACTION.allow },
        { tool: "grep", action: PERMISSION_ACTION.allow },
        { tool: "glob", action: PERMISSION_ACTION.allow },
      ],
    })) {
      events.push(e);
    }

    const toolResults = events.filter((e: any) => e.type === "tool_result") as Array<any>;
    expect(toolResults).toHaveLength(3);
    expect(toolResults.some((e: any) => (e as any).output === "file content")).toBe(true);
    expect(toolResults.some((e: any) => (e as any).output === "grep result")).toBe(true);
    expect(toolResults.some((e: any) => (e as any).output === "glob result")).toBe(true);
  });

  it("executes unsafe tools sequentially", async () => {
    const adapter = createMockAdapter({
      name: "test-mock",
      responses: [
        [
          {
            type: "tool_use",
            id: "t1",
            name: "bash",
            input: { command: "echo hello" },
          },
          {
            type: "tool_use",
            id: "t2",
            name: "write_file",
            input: { path: "test.txt", content: "hello" },
          },
        ],
        [{ type: "text_delta", text: "Completed" }],
      ],
    });

    let bashExecutedFirst = false;
    let writeFileStartedAfterBash = false;

    const bashHandler = { 
      name: "bash", 
      description: "Bash command", 
      inputSchema: {}, 
      execute: async (_input: unknown) => {
        bashExecutedFirst = true;
        // Simulate async delay
        await new Promise(resolve => setTimeout(resolve, 10));
        return { output: "bash result", isError: false }; 
      } 
    };
    const writeFileHandler = { 
      name: "write_file", 
      description: "Write file", 
      inputSchema: {}, 
      execute: async (_input: unknown) => {
        writeFileStartedAfterBash = bashExecutedFirst;
        return { output: "write success", isError: false }; 
      } 
    };

    const toolHandlers = new Map<string, ToolHandler>([
      ["bash", bashHandler],
      ["write_file", writeFileHandler],
    ]);

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
      permissionRules: [
        { tool: "bash", action: PERMISSION_ACTION.allow },
        { tool: "write_file", action: PERMISSION_ACTION.allow },
      ],
    })) {
      events.push(e);
    }

    expect(writeFileStartedAfterBash).toBe(true);
  });

  it("handles mixed batch of safe and unsafe tools in correct order", async () => {
    const adapter = createMockAdapter({
      name: "test-mock",
      responses: [
        [
          {
            type: "tool_use",
            id: "t1",
            name: "read_file",
            input: { path: "file1.txt" },
          },
          {
            type: "tool_use",
            id: "t2",
            name: "grep",
            input: { pattern: "test", path: "." },
          },
          {
            type: "tool_use",
            id: "t3",
            name: "bash",
            input: { command: "echo hello" },
          },
          {
            type: "tool_use",
            id: "t4",
            name: "write_file",
            input: { path: "test.txt", content: "hello" },
          },
        ],
        [{ type: "text_delta", text: "Completed" }],
      ],
    });

    const readFileSync = { name: "read_file", isConcurrencySafe: true, description: "Read file", inputSchema: {}, execute: async (_input: unknown) => ({ output: "file content", isError: false }) };
    const grepSync = { name: "grep", isConcurrencySafe: true, description: "Grep", inputSchema: {}, execute: async (_input: unknown) => ({ output: "grep result", isError: false }) };
    const bashHandler = { name: "bash", description: "Bash command", inputSchema: {}, execute: async (_input: unknown) => ({ output: "bash result", isError: false }) };
    const writeHandler = { name: "write_file", description: "Write file", inputSchema: {}, execute: async (_input: unknown) => ({ output: "write result", isError: false }) };

    const toolHandlers = new Map<string, ToolHandler>([
      ["read_file", readFileSync],
      ["grep", grepSync],
      ["bash", bashHandler],
      ["write_file", writeHandler],
    ]);

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
      permissionRules: [
        { tool: "read_file", action: PERMISSION_ACTION.allow },
        { tool: "grep", action: PERMISSION_ACTION.allow },
        { tool: "bash", action: PERMISSION_ACTION.allow },
        { tool: "write_file", action: PERMISSION_ACTION.allow },
      ],
    })) {
      events.push(e);
    }

    const toolResults = events.filter((e: any) => e.type === "tool_result") as Array<{ id: string }>;
    expect(toolResults).toHaveLength(4);
    
    // Results should maintain original order regardless of execution order
    expect(toolResults[0].id).toBe("t1"); // read_file
    expect(toolResults[1].id).toBe("t2"); // grep
    expect(toolResults[2].id).toBe("t3"); // bash
    expect(toolResults[3].id).toBe("t4"); // write_file
  });

  it("respects MAX_PARALLEL_TOOLS limit", async () => {
    const adapter = createMockAdapter({
      name: "test-mock",
      responses: [
        Array.from({ length: 8 }, (_, i) => ({
          type: "tool_use",
          id: `t${i + 1}`,
          name: "read_file",
          input: { path: `file${i + 1}.txt` },
        })),
        [{ type: "text_delta", text: "Completed" }],
      ],
    });

    // Track execution concurrency
    let activeCount = 0;
    let maxActive = 0;
    const readFileSync = { 
      name: "read_file", 
      isConcurrencySafe: true, 
      description: "Read file", 
      inputSchema: {}, 
      async execute(_input: unknown) {
        activeCount++;
        if (activeCount > maxActive) maxActive = activeCount;
        await new Promise(resolve => setTimeout(resolve, 10)); // Simulate async processing
        activeCount--;
        return { output: "file content", isError: false }; 
      } 
    };

    const toolHandlers = new Map<string, ToolHandler>([["read_file", readFileSync]]);

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
      permissionRules: [{ tool: "read_file", action: PERMISSION_ACTION.allow }],
    })) {
      events.push(e);
    }

    // Should respect MAX_PARALLEL_TOOLS = 5
    expect(maxActive).toBeLessThanOrEqual(5);
  });

  it("excludes permission denied tools from batch execution", async () => {
    const adapter = createMockAdapter({
      name: "test-mock",
      responses: [
        [
          {
            type: "tool_use",
            id: "t1",
            name: "read_file",
            input: { path: "file1.txt" },
          },
          {
            type: "tool_use",
            id: "t2",
            name: "bash",
            input: { command: "echo hello" },
          },
          {
            type: "tool_use",
            id: "t3",
            name: "grep",
            input: { pattern: "test", path: "." },
          },
        ],
        [{ type: "text_delta", text: "Completed" }],
      ],
    });

    const readFileSync = { name: "read_file", isConcurrencySafe: true, description: "Read file", inputSchema: {}, execute: async (_input: unknown) => ({ output: "file content", isError: false }) };
    const bashHandler = { name: "bash", description: "Bash command", inputSchema: {}, execute: async (_input: unknown) => ({ output: "bash result", isError: false }) };
    const grepSync = { name: "grep", isConcurrencySafe: true, description: "Grep", inputSchema: {}, execute: async (_input: unknown) => ({ output: "grep result", isError: false }) };

    const toolHandlers = new Map<string, ToolHandler>([
      ["read_file", readFileSync],
      ["bash", bashHandler],
      ["grep", grepSync],
    ]);

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
      permissionRules: [
        { tool: "read_file", action: PERMISSION_ACTION.allow },
        { tool: "grep", action: PERMISSION_ACTION.allow },
        // Intentionally denying bash
      ],
    })) {
      events.push(e);
    }

    const toolResults = events.filter((e: any) => e.type === "tool_result") as Array<any>;
    const deniedResult = toolResults.find((e: any) => (e as any).output.includes("Permission denied"));
    expect(deniedResult).toBeDefined();
    expect((deniedResult as any).id).toBe("t2"); // bash should be denied
    
    // Safe tools should still execute
    expect(toolResults.some((e: any) => (e as any).output === "file content")).toBe(true);
    expect(toolResults.some((e: any) => (e as any).output === "grep result")).toBe(true);
  });

  it("executes MCP tools sequentially", async () => {
    // Register an MCP tool for this test
    registerMcpTools([{
      name: "test_mcp_tool",
      description: "Test MCP tool",
      inputSchema: { type: "object", properties: { param: { type: "string" } } }
    }]);
    
    const adapter = createMockAdapter({
      name: "test-mock",
      responses: [
        [
          {
            type: "tool_use",
            id: "t1",
            name: "test_mcp_tool",
            input: { param: "value" },
          },
        ],
        [{ type: "text_delta", text: "Completed" }],
      ],
    });

    let mcpCalled = false;
    const mcpCallTool = async (name: string, input: unknown) => {
      mcpCalled = true;
      expect(name).toBe("test_mcp_tool");
      expect(input).toEqual({ param: "value" });
      return { output: `MCP result for ${name}`, isError: false };
    };

    const events: unknown[] = [];
    for await (const e of runAgentLoop({
      adapter,
      systemPrompt: "sys",
      userPrompt: "user",
      tools: [],
      maxIterations: 3,
      tokenBudget: 1000,
      workspacePath: "/tmp",
      mcpCallTool,
      permissionRules: [{ tool: "test_mcp_tool", action: PERMISSION_ACTION.allow }],
    })) {
      events.push(e);
    }

    expect(mcpCalled).toBe(true);
    const toolResults = events.filter((e: any) => e.type === "tool_result") as Array<any>;
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0].output).toBe("MCP result for test_mcp_tool");
    
    // Clean up by clearing the registry for other tests
    clearRegistry();
  });

  it("preserves original tool result order", async () => {
    const adapter = createMockAdapter({
      name: "test-mock",
      responses: [
        [
          {
            type: "tool_use",
            id: "t1",
            name: "slow_tool",
            input: {},
          },
          {
            type: "tool_use",
            id: "t2",
            name: "fast_tool",
            input: {},
          },
          {
            type: "tool_use",
            id: "t3",
            name: "medium_tool",
            input: {},
          },
        ],
        [{ type: "text_delta", text: "Completed" }],
      ],
    });

    // Slow, fast, medium tools to simulate different execution times
    const slowTool = { name: "slow_tool", isConcurrencySafe: true, description: "Slow tool", inputSchema: {}, async execute(_input: unknown) {
      await new Promise(resolve => setTimeout(resolve, 30));
      return { output: "slow result", isError: false };
    }};
    const fastTool = { name: "fast_tool", isConcurrencySafe: true, description: "Fast tool", inputSchema: {}, async execute(_input: unknown) {
      await new Promise(resolve => setTimeout(resolve, 5));
      return { output: "fast result", isError: false };
    }};
    const mediumTool = { name: "medium_tool", isConcurrencySafe: true, description: "Medium tool", inputSchema: {}, async execute(_input: unknown) {
      await new Promise(resolve => setTimeout(resolve, 15));
      return { output: "medium result", isError: false };
    }};

    const toolHandlers = new Map<string, ToolHandler>([
      ["slow_tool", slowTool],
      ["fast_tool", fastTool],
      ["medium_tool", mediumTool],
    ]);

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
      permissionRules: [
        { tool: "slow_tool", action: PERMISSION_ACTION.allow },
        { tool: "fast_tool", action: PERMISSION_ACTION.allow },
        { tool: "medium_tool", action: PERMISSION_ACTION.allow },
      ],
    })) {
      events.push(e);
    }

    const toolResults = events.filter((e: any) => e.type === "tool_result") as Array<{ id: string }>;
    expect(toolResults).toHaveLength(3);
    
    // Despite different execution times, results should be in original order
    expect(toolResults[0].id).toBe("t1"); // slow_tool 
    expect(toolResults[1].id).toBe("t2"); // fast_tool (should come second despite being faster)
    expect(toolResults[2].id).toBe("t3"); // medium_tool
  });

  it("single tool behavior unchanged", async () => {
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
      permissionRules: [{ tool: "echo", action: PERMISSION_ACTION.allow }],
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
});
