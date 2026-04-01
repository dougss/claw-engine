import type { ToolDefinition } from "../../types.js";

export interface McpToolSchema {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** Translate MCP tool schema to OpenAI function-calling format (used by AlibabaAdapter). */
export function translateMcpToolToOpenAI(tool: McpToolSchema): OpenAITool {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description ?? "",
      parameters: tool.inputSchema,
    },
  };
}

/** Translate MCP tool schema to harness ToolDefinition (used by tool-registry). */
export function translateMcpToolToHarness(tool: McpToolSchema): ToolDefinition {
  return {
    name: tool.name,
    description: tool.description ?? "",
    inputSchema: tool.inputSchema,
  };
}
