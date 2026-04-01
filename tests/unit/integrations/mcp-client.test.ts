import { describe, it, expect } from "vitest";
import {
  translateMcpToolToOpenAI,
  translateMcpToolToHarness,
} from "../../../src/integrations/mcp/schema-translator.js";

describe("schema-translator", () => {
  const sampleMcpTool = {
    name: "bash",
    description: "Run shell commands",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to run" },
        timeout: { type: "number", description: "Timeout in ms" },
      },
      required: ["command"],
    },
  };

  it("translates MCP tool to OpenAI function-calling format", () => {
    const result = translateMcpToolToOpenAI(sampleMcpTool);
    expect(result.type).toBe("function");
    expect(result.function.name).toBe("bash");
    expect(result.function.description).toBe("Run shell commands");
    expect(result.function.parameters).toEqual(sampleMcpTool.inputSchema);
  });

  it("translates MCP tool to harness ToolDefinition", () => {
    const result = translateMcpToolToHarness(sampleMcpTool);
    expect(result.name).toBe("bash");
    expect(result.description).toBe("Run shell commands");
    expect(result.inputSchema).toEqual(sampleMcpTool.inputSchema);
  });

  it("handles tool with no description", () => {
    const tool = {
      name: "test",
      inputSchema: { type: "object", properties: {} },
    };
    const result = translateMcpToolToHarness(tool);
    expect(result.name).toBe("test");
    expect(result.description).toBe("");
  });
});
