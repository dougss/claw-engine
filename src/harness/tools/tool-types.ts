import type { ToolResult } from "../../types.js";

export interface ToolContext {
  workspacePath: string;
  sessionId: string;
  onAskUser?: (question: string) => Promise<string>;
}

export interface ToolHandler {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: unknown, context: ToolContext) => Promise<ToolResult>;
}
