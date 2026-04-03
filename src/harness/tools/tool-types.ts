import type { ToolResult } from "../../types.js";

export interface ToolContext {
  workspacePath: string;
  sessionId: string;
  workItemId?: string;
  onAskUser?: (question: string) => Promise<string>;
}

export interface ToolHandler {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Optional max size for tool result output in characters. Defaults applied in agent-loop. */
  maxResultSizeChars?: number;
  /** When true, this tool is safe to execute concurrently with other safe tools. Defaults to false. */
  isConcurrencySafe?: boolean;
  execute: (input: unknown, context: ToolContext) => Promise<ToolResult>;
}
