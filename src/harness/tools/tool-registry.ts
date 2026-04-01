import type { ToolDefinition } from "../../types.js";
import type { ToolHandler } from "./tool-types.js";

const toolsByName = new Map<string, ToolHandler>();

export function registerTool(handler: ToolHandler) {
  toolsByName.set(handler.name, handler);
}

export function getTool(name: string) {
  return toolsByName.get(name) ?? null;
}

export function getAllTools() {
  return Array.from(toolsByName.values());
}

export function getToolDefinitions(): ToolDefinition[] {
  return getAllTools().map((handler) => ({
    name: handler.name,
    description: handler.description,
    inputSchema: handler.inputSchema,
  }));
}

export function registerMcpTools(tools: ToolDefinition[]): void {
  for (const tool of tools) {
    // Only register definition, not handler — MCP tools are handled by McpClientManager
    if (!toolsByName.has(tool.name)) {
      toolsByName.set(tool.name, {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        async execute(_input, _context) {
          return {
            output: `MCP tool ${tool.name}: not directly executable via registry`,
            isError: false,
          };
        },
      });
    }
  }
}
