import { useState, useEffect, useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  BackgroundVariant,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  fetchWorkItems,
  fetchWorkItem,
  type WorkItem,
  type TaskFull,
} from "../lib/api";
import { PageHeader, EmptyState } from "../components/ui";

// ── Status color map ──────────────────────────────────────────────────────────

const STATUS_GLOW: Record<
  string,
  { border: string; shadow: string; accent: string }
> = {
  completed: {
    border: "rgba(57,255,140,0.5)",
    shadow: "rgba(57,255,140,0.15)",
    accent: "#39ff8c",
  },
  running: {
    border: "rgba(0,212,255,0.5)",
    shadow: "rgba(0,212,255,0.15)",
    accent: "#00d4ff",
  },
  failed: {
    border: "rgba(255,77,109,0.5)",
    shadow: "rgba(255,77,109,0.15)",
    accent: "#ff4d6d",
  },
  pending: {
    border: "rgba(245,158,11,0.4)",
    shadow: "rgba(245,158,11,0.08)",
    accent: "#f59e0b",
  },
  validating: {
    border: "rgba(129,140,248,0.4)",
    shadow: "rgba(129,140,248,0.1)",
    accent: "#818cf8",
  },
  provisioning: {
    border: "rgba(167,139,250,0.4)",
    shadow: "rgba(167,139,250,0.1)",
    accent: "#a78bfa",
  },
  checkpointing: {
    border: "rgba(251,146,60,0.4)",
    shadow: "rgba(251,146,60,0.08)",
    accent: "#fb923c",
  },
  starting: {
    border: "rgba(251,191,36,0.4)",
    shadow: "rgba(251,191,36,0.08)",
    accent: "#fbbf24",
  },
};

const FALLBACK_GLOW = {
  border: "rgba(46,74,106,0.6)",
  shadow: "rgba(0,0,0,0.1)",
  accent: "#5c7a9e",
};

// ── DAG node ──────────────────────────────────────────────────────────────────

function buildNodes(tasks: TaskFull[]): Node[] {
  return tasks.map((task, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const cfg = STATUS_GLOW[task.status] ?? FALLBACK_GLOW;
    return {
      id: task.id,
      position: { x: 60 + col * 280, y: 60 + row * 150 },
      data: {
        label: (
          <div className="space-y-2">
            <div
              className="text-xs font-medium leading-snug"
              style={{ color: "#e8f0fe", fontFamily: "Inter, sans-serif" }}
            >
              {task.description.length > 60
                ? task.description.slice(0, 57) + "…"
                : task.description}
            </div>
            <div className="flex items-center gap-1.5">
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: cfg.accent }}
              />
              <span
                className="text-[10px] font-mono uppercase tracking-wider"
                style={{ color: cfg.accent }}
              >
                {task.status}
              </span>
            </div>
          </div>
        ),
      },
      style: {
        background: "linear-gradient(135deg, #0a1628, #0f1f35)",
        border: `1px solid ${cfg.border}`,
        borderRadius: 12,
        color: "#e8f0fe",
        padding: "12px 16px",
        minWidth: 210,
        boxShadow: `0 0 0 1px ${cfg.border}22, 0 4px 20px ${cfg.shadow}, inset 0 1px 0 rgba(255,255,255,0.04)`,
      },
    };
  });
}

// ── Work item selector ────────────────────────────────────────────────────────

function WorkItemSelector({
  workItems,
  selected,
  onSelect,
}: {
  workItems: WorkItem[];
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <label
        htmlFor="wi-select"
        className="text-[10px] font-mono text-text-muted uppercase tracking-widest shrink-0"
      >
        Work Item
      </label>
      <select
        id="wi-select"
        className="bg-surface-2 border border-border-3 text-xs text-text-secondary px-3 py-1.5 rounded-lg cursor-pointer focus:outline-none focus:border-accent/40 transition-colors duration-150 font-mono hover:border-border-4 hover:text-text-primary"
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
  );
}

// ── Legend ────────────────────────────────────────────────────────────────────

function buildEdges(tasks: TaskFull[]): Edge[] {
  const edges: Edge[] = [];
  for (const task of tasks) {
    if (!task.dependsOn) continue;
    for (const depId of task.dependsOn) {
      edges.push({
        id: `${depId}->${task.id}`,
        source: depId,
        target: task.id,
        style: { stroke: "rgba(0,212,255,0.3)", strokeWidth: 1.5 },
        animated: task.status === "running",
      });
    }
  }
  return edges;
}

function Legend({ tasks }: { tasks: TaskFull[] }) {
  const statusCounts = tasks.reduce<Record<string, number>>((acc, t) => {
    acc[t.status] = (acc[t.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div
      className="px-5 py-3 border-t border-border-2 flex items-center gap-1 flex-wrap"
      style={{ background: "rgba(5,10,15,0.6)" }}
    >
      <span className="text-[9px] font-mono text-text-dim uppercase tracking-widest mr-2">
        Legend
      </span>
      {Object.entries(statusCounts).map(([status, count]) => {
        const cfg = STATUS_GLOW[status] ?? FALLBACK_GLOW;
        return (
          <span
            key={status}
            className="flex items-center gap-1.5 px-2 py-0.5 rounded-md mr-1"
            style={{ background: `${cfg.shadow}` }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: cfg.accent }}
            />
            <span
              className="text-[10px] font-mono"
              style={{ color: cfg.accent }}
            >
              {status}
            </span>
            <span className="text-[10px] font-mono text-text-dim">
              ×{count}
            </span>
          </span>
        );
      })}
      <span className="ml-auto text-[10px] font-mono text-text-dim">
        {tasks.length} tasks total
      </span>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function DagPage() {
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TaskFull[]>([]);

  const loadWorkItems = useCallback(() => {
    fetchWorkItems().then(setWorkItems).catch(console.error);
  }, []);

  useEffect(() => {
    loadWorkItems();
    const interval = setInterval(loadWorkItems, 5000);
    return () => clearInterval(interval);
  }, [loadWorkItems]);

  useEffect(() => {
    if (!selected) return;
    fetchWorkItem(selected)
      .then((wi) => setTasks((wi.tasks ?? []) as TaskFull[]))
      .catch(console.error);
    const interval = setInterval(() => {
      fetchWorkItem(selected)
        .then((wi) => setTasks((wi.tasks ?? []) as TaskFull[]))
        .catch(console.error);
    }, 4000);
    return () => clearInterval(interval);
  }, [selected]);

  const nodes: Node[] = buildNodes(tasks);
  const edges: Edge[] = buildEdges(tasks);

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <PageHeader
        title="DAG View"
        description="Task dependency graph visualizer"
        actions={
          <WorkItemSelector
            workItems={workItems}
            selected={selected}
            onSelect={setSelected}
          />
        }
      />

      <div className="flex-1 min-h-0 relative">
        {!selected ? (
          <EmptyState
            icon={
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <circle cx="5" cy="12" r="2" />
                <circle cx="19" cy="5" r="2" />
                <circle cx="19" cy="19" r="2" />
                <line x1="7" y1="11.5" x2="17" y2="6.5" />
                <line x1="7" y1="12.5" x2="17" y2="17.5" />
              </svg>
            }
            title="Select a work item"
            description="Choose a work item from the dropdown to visualize its task dependency graph"
          />
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.3}
            maxZoom={2}
          >
            <Background
              variant={BackgroundVariant.Dots}
              color="rgba(46,74,106,0.35)"
              gap={24}
              size={1}
            />
            <Controls />
          </ReactFlow>
        )}
      </div>

      {selected && tasks.length > 0 && <Legend tasks={tasks} />}
    </div>
  );
}
