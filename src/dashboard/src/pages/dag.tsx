import { useState, useEffect } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  fetchWorkItems,
  fetchWorkItem,
  type WorkItem,
  type Task,
} from "../lib/api";

const STATUS_COLOR: Record<string, string> = {
  completed: "#22c55e",
  running: "#3b82f6",
  failed: "#ef4444",
  pending: "#6b7280",
  validating: "#8b5cf6",
};

// ── Page header ───────────────────────────────────────────────────────────────

function PageHeader({
  workItems,
  selected,
  onSelect,
}: {
  workItems: WorkItem[];
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  return (
    <div className="flex items-center justify-between px-6 py-4 border-b border-border-2 bg-surface/50">
      <div>
        <h1 className="text-sm font-semibold text-text-primary">DAG View</h1>
        <p className="text-xs text-text-muted mt-0.5">Task dependency graph</p>
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor="wi-select" className="text-xs text-text-dim">
          Work item
        </label>
        <select
          id="wi-select"
          className="bg-surface-2 border border-border-3 text-sm text-text-primary px-3 py-1.5 rounded-lg cursor-pointer focus:outline-none focus:border-accent/40 transition-colors duration-150"
          value={selected ?? ""}
          onChange={(e) => onSelect(e.target.value || null)}
        >
          <option value="">— select —</option>
          {workItems.map((wi) => (
            <option key={wi.id} value={wi.id}>
              {wi.title} · {wi.status}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
      <div className="w-10 h-10 rounded-xl bg-surface-2 border border-border-3 flex items-center justify-center">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="text-text-dim"
        >
          <circle cx="5" cy="12" r="2" />
          <circle cx="19" cy="5" r="2" />
          <circle cx="19" cy="19" r="2" />
          <line x1="7" y1="11.5" x2="17" y2="6.5" />
          <line x1="7" y1="12.5" x2="17" y2="17.5" />
        </svg>
      </div>
      <p className="text-sm font-medium text-text-primary">
        Select a work item
      </p>
      <p className="text-xs text-text-muted">
        Choose one from the dropdown to visualize its task graph
      </p>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function DagPage() {
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    fetchWorkItems().then(setWorkItems).catch(console.error);
    const interval = setInterval(() => {
      fetchWorkItems().then(setWorkItems).catch(console.error);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!selected) return;
    fetchWorkItem(selected)
      .then((wi) => setTasks(wi.tasks))
      .catch(console.error);
  }, [selected]);

  const nodes: Node[] = tasks.map((task, i) => ({
    id: task.id,
    position: { x: 100 + (i % 3) * 240, y: 80 + Math.floor(i / 3) * 130 },
    data: {
      label: (
        <div className="text-xs leading-snug">
          <div className="font-medium text-[#f8fafc] truncate max-w-[160px] mb-1">
            {task.description}
          </div>
          <div
            className="font-mono"
            style={{ color: STATUS_COLOR[task.status] ?? "#9ca3af" }}
          >
            {task.status}
          </div>
        </div>
      ),
    },
    style: {
      background: "#0f172a",
      border: `1px solid ${STATUS_COLOR[task.status] ?? "#1e293b"}`,
      borderRadius: 10,
      color: "#f8fafc",
      padding: "10px 14px",
      minWidth: 190,
      boxShadow: `0 0 0 1px ${STATUS_COLOR[task.status] ?? "#1e293b"}22`,
    },
  }));

  const edges: Edge[] = [];

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        workItems={workItems}
        selected={selected}
        onSelect={setSelected}
      />

      <div className="flex-1 min-h-0">
        {!selected ? (
          <EmptyState />
        ) : (
          <ReactFlow nodes={nodes} edges={edges} fitView>
            <Background color="#1e293b" gap={20} />
            <Controls />
          </ReactFlow>
        )}
      </div>

      {selected && tasks.length > 0 && (
        <div className="px-6 py-3 border-t border-border-2 flex items-center gap-4">
          {Object.entries(STATUS_COLOR).map(([status, color]) => (
            <span key={status} className="flex items-center gap-1.5">
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: color }}
              />
              <span className="text-xs text-text-muted font-mono">
                {status}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
