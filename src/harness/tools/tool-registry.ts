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
