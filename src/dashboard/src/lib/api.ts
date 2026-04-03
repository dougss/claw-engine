const BASE = "/api/v1";

export type PipelinePhase = "plan" | "execute" | "validate" | "review" | "pr";

// All event types emitted by the backend SSE stream
export type SseEventType =
  | "session_start"
  | "session_end"
  | "session_resume"
  | "text_delta"
  | "tool_use"
  | "tool_result"
  | "token_update"
  | "checkpoint"
  | "compaction"
  | "api_retry"
  | "model_fallback"
  | "permission_denied"
  | "validation_result"
  | "phase_start"
  | "phase_end"
  | "error"
  // server infrastructure
  | "ping"
  // catch-all for unknown future events
  | (string & Record<never, never>);

export interface WorkItem {
  id: string;
  title: string;
  description: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  totalTokensUsed: number;
  totalCostUsd: string;
  tasksTotal: number;
  tasksCompleted: number;
}

export interface Task {
  id: string;
  description: string;
  status: string;
  model: string | null;
  tokensUsed: number;
  costUsd: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
}

export interface TaskFull extends Task {
  dagNodeId: string;
  repo: string;
  dependsOn: string[] | null;
  workItemId: string;
  prUrl: string | null;
  validationAttempts: number;
}

export interface TelemetryEntry {
  id: string;
  taskId: string;
  eventType: string;
  data: unknown;
  createdAt: string;
}

export interface TaskWithTelemetry extends TaskFull {
  telemetry: TelemetryEntry[];
}

export interface Execution extends WorkItem {
  tasks: TaskFull[];
}

export interface Metrics {
  tasks: {
    total: number;
    completed: number;
    failed: number;
    running: number;
    pending: number;
    totalTokens: number;
    totalCost: number;
  };
  workItems: {
    total: number;
    active: number;
  };
}

export interface CostDataPoint {
  index: number;
  label: string;
  cost: number;
  tokens: number;
  date: string;
}

export interface LogEntry {
  id: string;
  taskId: string | null;
  eventType: string | null;
  data: unknown;
  createdAt: string;
}

export async function fetchExecutions(limit = 50): Promise<Execution[]> {
  const res = await fetch(`${BASE}/work-items?with_tasks=1&limit=${limit}`);
  if (!res.ok) throw new Error(`fetchExecutions: ${res.status}`);
  const data = (await res.json()) as { items: Execution[] };
  return data.items;
}

export async function fetchWorkItems(status?: string): Promise<WorkItem[]> {
  const url = status
    ? `${BASE}/work-items?status=${status}`
    : `${BASE}/work-items`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetchWorkItems: ${res.status}`);
  const data = (await res.json()) as { items: WorkItem[] };
  return data.items;
}

export async function fetchWorkItem(
  id: string,
): Promise<WorkItem & { tasks: TaskFull[] }> {
  const res = await fetch(`${BASE}/work-items/${id}`);
  if (!res.ok) throw new Error(`fetchWorkItem: ${res.status}`);
  return res.json() as Promise<WorkItem & { tasks: TaskFull[] }>;
}

export async function fetchMetrics(): Promise<Metrics> {
  const res = await fetch(`${BASE}/metrics`);
  if (!res.ok) throw new Error(`fetchMetrics: ${res.status}`);
  return res.json() as Promise<Metrics>;
}

export async function fetchSessions(): Promise<TaskFull[]> {
  const res = await fetch(`${BASE}/sessions`);
  if (!res.ok) throw new Error(`fetchSessions: ${res.status}`);
  const data = (await res.json()) as { sessions: TaskFull[] };
  return data.sessions;
}

export async function fetchAllTasks(limit = 50): Promise<TaskFull[]> {
  const res = await fetch(`${BASE}/tasks?limit=${limit}`);
  if (!res.ok) throw new Error(`fetchAllTasks: ${res.status}`);
  const data = (await res.json()) as { tasks: TaskFull[] };
  return data.tasks;
}

export async function fetchTaskWithTelemetry(
  id: string,
): Promise<TaskWithTelemetry> {
  const res = await fetch(`${BASE}/tasks/${id}`);
  if (!res.ok) throw new Error(`fetchTaskWithTelemetry: ${res.status}`);
  return res.json() as Promise<TaskWithTelemetry>;
}

export async function fetchLogs(taskId?: string): Promise<LogEntry[]> {
  const url = taskId ? `${BASE}/logs?task_id=${taskId}` : `${BASE}/logs`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetchLogs: ${res.status}`);
  const json = (await res.json()) as { entries: LogEntry[] };
  return json.entries;
}

export async function fetchCostHistory(limit = 20): Promise<CostDataPoint[]> {
  const executions = await fetchExecutions(limit);
  return executions
    .filter((e) => Number(e.totalCostUsd) > 0)
    .map((e, i) => ({
      index: i,
      label: e.title.slice(0, 24),
      cost: Number(e.totalCostUsd),
      tokens: e.totalTokensUsed,
      date: e.createdAt,
    }))
    .reverse();
}
