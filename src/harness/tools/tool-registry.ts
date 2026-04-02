import type { ToolDefinition } from "../../types.js";
import type { ToolHandler } from "./tool-types.js";
import { webFetchTool } from "./builtins/web-fetch.js";
import { webSearchTool } from "./builtins/web-search.js";
import { taskCreateTool, taskListTool, taskUpdateTool, taskGetTool } from "./builtins/task-tools.js";

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

export function getToolsByNames(names: string[]): ToolHandler[] {
  const result: ToolHandler[] = [];
  for (const name of names) {
    const handler = toolsByName.get(name);
    if (handler) result.push(handler);
  }
  return result;
}

export function clearRegistry(): void {
  toolsByName.clear();
  mcpToolsByName.clear();
}

registerTool(webFetchTool);
registerTool(webSearchTool);
registerTool(taskCreateTool);
registerTool(taskListTool);
registerTool(taskUpdateTool);
registerTool(taskGetTool);
