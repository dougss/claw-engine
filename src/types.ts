export const TASK_STATUS = {
  pending: "pending",
  merging_dependency: "merging_dependency",
  provisioning: "provisioning",
  starting: "starting",
  running: "running",
  checkpointing: "checkpointing",
  resuming: "resuming",
  validating: "validating",
  completed: "completed",
  stalled: "stalled",
  failed: "failed",
  needs_human_review: "needs_human_review",
  interrupted: "interrupted",
  blocked: "blocked",
  skipped: "skipped",
  cancelled: "cancelled",
} as const;

export type TaskStatus = (typeof TASK_STATUS)[keyof typeof TASK_STATUS];

export const WORK_ITEM_STATUS = {
  queued: "queued",
  decomposing: "decomposing",
  running: "running",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
} as const;

export type WorkItemStatus =
  (typeof WORK_ITEM_STATUS)[keyof typeof WORK_ITEM_STATUS];

export interface ToolCallRecord {
  id: string;
  name: string;
  /** Serialized JSON arguments string (mirrors OpenAI wire format) */
  arguments: string;
}

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolUseId?: string;
  toolName?: string;
  /** For assistant messages: the tool calls made in this turn */
  toolCalls?: ToolCallRecord[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolResult {
  output: string;
  isError: boolean;
}
