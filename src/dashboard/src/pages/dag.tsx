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
    position: { x: 100 + (i % 3) * 220, y: 80 + Math.floor(i / 3) * 120 },
    data: {
      label: (
        <div className="text-xs">
          <div className="font-medium truncate max-w-[160px]">
            {task.description}
          </div>
          <div style={{ color: STATUS_COLOR[task.status] ?? "#9ca3af" }}>
            {task.status}
          </div>
        </div>
      ),
    },
    style: {
      background: "#1f2937",
      border: `1px solid ${STATUS_COLOR[task.status] ?? "#374151"}`,
      borderRadius: 8,
      color: "#fff",
      padding: "8px 12px",
      minWidth: 180,
    },
  }));

  const edges: Edge[] = [];

  return (
    <div className="p-4 space-y-4 h-full flex flex-col">
      <div className="flex items-center gap-3">
        <h2 className="text-xl font-semibold text-white">DAG View</h2>
        <select
          className="ml-auto bg-gray-700 text-sm text-white px-3 py-1 rounded border border-gray-600 focus:outline-none"
          value={selected ?? ""}
          onChange={(e) => setSelected(e.target.value || null)}
        >
          <option value="">— Select work item —</option>
          {workItems.map((wi) => (
            <option key={wi.id} value={wi.id}>
              {wi.title} ({wi.status})
            </option>
          ))}
        </select>
      </div>

      <div className="flex-1 bg-gray-900 rounded-lg" style={{ height: 400 }}>
        {!selected ? (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            Select a work item to view its DAG
          </div>
        ) : (
          <ReactFlow nodes={nodes} edges={edges} fitView>
            <Background color="#374151" gap={16} />
            <Controls />
          </ReactFlow>
        )}
      </div>

      {selected && tasks.length > 0 && (
        <div className="flex gap-2 text-xs">
          {Object.entries(STATUS_COLOR).map(([status, color]) => (
            <span key={status} className="flex items-center gap-1">
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: color }}
              />
              <span className="text-gray-400">{status}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
