import type { ToolDefinition } from "../../types.js";
import type { ToolHandler } from "./tool-types.js";

const toolsByName = new Map<string, ToolHandler>();
const mcpToolsByName = new Map<string, ToolDefinition>();

export function registerTool(handler: ToolHandler) {
  toolsByName.set(handler.name, handler);
}

export function getTool(name: string) {
  return toolsByName.get(name) ?? null;
}

export function isMcpTool(name: string) {
  return mcpToolsByName.has(name);
}

export function getAllTools() {
  return Array.from(toolsByName.values());
}

export function getToolDefinitions(): ToolDefinition[] {
  const builtins = getAllTools().map((handler) => ({
    name: handler.name,
    description: handler.description,
    inputSchema: handler.inputSchema,
  }));

  return [...builtins, ...mcpToolsByName.values()];
}

export function registerMcpTools(tools: ToolDefinition[]): void {
  for (const tool of tools) {
    if (toolsByName.has(tool.name)) continue;
    mcpToolsByName.set(tool.name, tool);
  }
}
