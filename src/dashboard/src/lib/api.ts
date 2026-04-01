const BASE = "/api";

export interface WorkItem {
  id: string;
  title: string;
  description: string | null;
  status: string;
  createdAt: string;
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

export async function fetchWorkItems(status?: string): Promise<WorkItem[]> {
  const url = status
    ? `${BASE}/work-items?status=${status}`
    : `${BASE}/work-items`;
  const res = await fetch(url);
  const data = (await res.json()) as { items: WorkItem[] };
  return data.items;
}

export async function fetchWorkItem(
  id: string,
): Promise<WorkItem & { tasks: Task[] }> {
  const res = await fetch(`${BASE}/work-items/${id}`);
  return res.json() as Promise<WorkItem & { tasks: Task[] }>;
}

export async function fetchMetrics(): Promise<Metrics> {
  const res = await fetch(`${BASE}/metrics`);
  return res.json() as Promise<Metrics>;
}

export async function fetchSessions(): Promise<Task[]> {
  const res = await fetch(`${BASE}/sessions`);
  const data = (await res.json()) as { sessions: Task[] };
  return data.sessions;
}

export interface LogEntry {
  id: string;
  taskId: string | null;
  eventType: string | null;
  payload: unknown;
  createdAt: string;
}

export async function fetchLogs(taskId?: string): Promise<LogEntry[]> {
  const url = taskId ? `${BASE}/logs?task_id=${taskId}` : `${BASE}/logs`;
  const res = await fetch(url);
  const data = (await res.json()) as { entries: LogEntry[] };
  return data.entries;
}
