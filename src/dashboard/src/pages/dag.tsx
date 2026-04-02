import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
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
  fetchTaskWithTelemetry,
  type WorkItem,
  type TaskFull,
} from "../lib/api";
import {
  extractPhaseEvents,
  isPipelineRun,
  PHASE_ORDER,
  PHASE_LABELS,
  PHASE_COLORS,
  getPhaseStatus,
  getCurrentPhase,
  formatDuration,
  type PhaseEvent,
} from "../lib/pipeline";
import { PageHeader, EmptyState } from "../components/ui";

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

function buildTaskNodes(
  tasks: TaskFull[],
  pipelinePhases: Map<string, PhaseEvent[]>,
): Node[] {
  const nodes: Node[] = [];
  let taskYOffset = 0;

  for (const task of tasks) {
    const phases = pipelinePhases.get(task.id);
    const hasPipeline = phases && phases.length > 0;

    if (hasPipeline) {
      const currentPhase = getCurrentPhase(phases);
      const xBase = 60;
      const yBase = taskYOffset;

      nodes.push({
        id: `task-label-${task.id}`,
        position: { x: xBase, y: yBase },
        data: {
          label: (
            <div className="space-y-1">
              <div className="text-xs font-medium" style={{ color: "#e8f0fe" }}>
                {task.description.length > 50
                  ? task.description.slice(0, 47) + "…"
                  : task.description}
              </div>
              <div className="flex items-center gap-1.5">
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{
                    backgroundColor: (STATUS_GLOW[task.status] ?? FALLBACK_GLOW)
                      .accent,
                  }}
                />
                <span
                  className="text-[9px] font-mono uppercase tracking-wider"
                  style={{
                    color: (STATUS_GLOW[task.status] ?? FALLBACK_GLOW).accent,
                  }}
                >
                  {task.status}
                </span>
              </div>
            </div>
          ),
        },
        style: {
          background: "linear-gradient(135deg, #0a1628, #0f1f35)",
          border: `1px solid ${(STATUS_GLOW[task.status] ?? FALLBACK_GLOW).border}`,
          borderRadius: 12,
          padding: "10px 14px",
          minWidth: 220,
          boxShadow: `0 0 0 1px ${(STATUS_GLOW[task.status] ?? FALLBACK_GLOW).border}22, 0 4px 20px ${(STATUS_GLOW[task.status] ?? FALLBACK_GLOW).shadow}`,
        },
      });

      PHASE_ORDER.forEach((phase, pi) => {
        const status = getPhaseStatus(phase, phases, currentPhase);
        const colors = PHASE_COLORS[phase];
        const end = phases.find(
          (p) => p.phase === phase && p.eventType === "phase_end",
        );
        const isPending = status === "pending";
        const isFailed = status === "failed";
        const isActive = status === "running";

        nodes.push({
          id: `phase-${task.id}-${phase}`,
          position: { x: xBase + 260 + pi * 160, y: yBase + 5 },
          data: {
            label: (
              <div className="space-y-1.5 text-center">
                <div className="flex items-center justify-center gap-1.5">
                  <span
                    className={`font-mono text-[9px] font-bold uppercase tracking-wider ${isActive ? "status-pulse" : ""}`}
                    style={{
                      color: isPending
                        ? "#2e4a6a"
                        : isFailed
                          ? "#ff4d6d"
                          : colors.accent,
                    }}
                  >
                    {PHASE_LABELS[phase]}
                  </span>
                  {status === "completed" && (
                    <svg
                      width="8"
                      height="8"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke={colors.accent}
                      strokeWidth="3"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                  {isFailed && (
                    <svg
                      width="8"
                      height="8"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#ff4d6d"
                      strokeWidth="3"
                    >
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  )}
                </div>
                {end?.durationMs !== undefined && (
                  <div className="text-[8px] font-mono text-text-dim">
                    {formatDuration(end.durationMs)}
                  </div>
                )}
              </div>
            ),
          },
          style: {
            background: isPending ? "rgba(46,74,106,0.08)" : colors.bg,
            border: `1px solid ${isPending ? "rgba(46,74,106,0.2)" : isFailed ? "rgba(255,77,109,0.4)" : colors.border}`,
            borderRadius: 10,
            padding: "8px 12px",
            minWidth: 90,
            opacity: isPending ? 0.5 : 1,
            boxShadow: isActive ? `0 0 12px ${colors.glow}` : "none",
          },
        });
      });

      taskYOffset += 100;
    } else {
      const cfg = STATUS_GLOW[task.status] ?? FALLBACK_GLOW;
      nodes.push({
        id: task.id,
        position: { x: 60, y: taskYOffset },
        data: {
          label: (
            <div className="space-y-2">
              <div
                className="text-xs font-medium leading-snug"
                style={{ color: "#e8f0fe" }}
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
      });
      taskYOffset += 120;
    }
  }

  return nodes;
}

function buildEdges(
  tasks: TaskFull[],
  pipelinePhases: Map<string, PhaseEvent[]>,
): Edge[] {
  const edges: Edge[] = [];

  for (const task of tasks) {
    if (task.dependsOn) {
      for (const depId of task.dependsOn) {
        edges.push({
          id: `dep-${depId}->${task.id}`,
          source: depId,
          target: pipelinePhases.has(task.id)
            ? `task-label-${task.id}`
            : task.id,
          style: { stroke: "rgba(0,212,255,0.3)", strokeWidth: 1.5 },
          animated: task.status === "running",
        });
      }
    }

    const phases = pipelinePhases.get(task.id);
    if (phases && phases.length > 0) {
      edges.push({
        id: `task-to-phase-${task.id}`,
        source: `task-label-${task.id}`,
        target: `phase-${task.id}-plan`,
        style: { stroke: "rgba(167,139,250,0.4)", strokeWidth: 1 },
      });

      for (let i = 0; i < PHASE_ORDER.length - 1; i++) {
        edges.push({
          id: `phase-edge-${task.id}-${PHASE_ORDER[i]}-${PHASE_ORDER[i + 1]}`,
          source: `phase-${task.id}-${PHASE_ORDER[i]}`,
          target: `phase-${task.id}-${PHASE_ORDER[i + 1]}`,
          style: { stroke: "rgba(0,212,255,0.2)", strokeWidth: 1 },
          animated: getCurrentPhase(phases) === PHASE_ORDER[i + 1],
        });
      }
    }
  }

  return edges;
}

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

function Legend({
  tasks,
  pipelinePhases,
}: {
  tasks: TaskFull[];
  pipelinePhases: Map<string, PhaseEvent[]>;
}) {
  const statusCounts = tasks.reduce<Record<string, number>>((acc, t) => {
    acc[t.status] = (acc[t.status] ?? 0) + 1;
    return acc;
  }, {});

  const hasPipeline = pipelinePhases.size > 0;

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
            style={{ background: cfg.shadow }}
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
              x{count}
            </span>
          </span>
        );
      })}
      {hasPipeline && (
        <>
          <span className="w-px h-3 bg-border-3 mx-2" />
          {PHASE_ORDER.map((phase) => {
            const colors = PHASE_COLORS[phase];
            return (
              <span
                key={phase}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded-md mr-0.5"
                style={{ background: colors.bg }}
              >
                <span
                  className="w-1 h-1 rounded-full"
                  style={{ backgroundColor: colors.accent }}
                />
                <span
                  className="text-[9px] font-mono"
                  style={{ color: colors.accent }}
                >
                  {PHASE_LABELS[phase]}
                </span>
              </span>
            );
          })}
        </>
      )}
      <span className="ml-auto text-[10px] font-mono text-text-dim">
        {tasks.length} tasks total
      </span>
    </div>
  );
}

export function DagPage() {
  const [searchParams] = useSearchParams();
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [selected, setSelected] = useState<string | null>(
    searchParams.get("wi"),
  );
  const [tasks, setTasks] = useState<TaskFull[]>([]);
  const [pipelinePhases, setPipelinePhases] = useState<
    Map<string, PhaseEvent[]>
  >(new Map());

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
      .then(async (wi) => {
        const taskList = (wi.tasks ?? []) as TaskFull[];
        setTasks(taskList);

        const phaseMap = new Map<string, PhaseEvent[]>();
        for (const task of taskList) {
          try {
            const tw = await fetchTaskWithTelemetry(task.id);
            if (isPipelineRun(tw.telemetry)) {
              phaseMap.set(task.id, extractPhaseEvents(tw.telemetry));
            }
          } catch {
            // skip
          }
        }
        setPipelinePhases(phaseMap);
      })
      .catch(console.error);

    const interval = setInterval(() => {
      fetchWorkItem(selected)
        .then(async (wi) => {
          const taskList = (wi.tasks ?? []) as TaskFull[];
          setTasks(taskList);

          const phaseMap = new Map<string, PhaseEvent[]>();
          for (const task of taskList) {
            try {
              const tw = await fetchTaskWithTelemetry(task.id);
              if (isPipelineRun(tw.telemetry)) {
                phaseMap.set(task.id, extractPhaseEvents(tw.telemetry));
              }
            } catch {
              // skip
            }
          }
          setPipelinePhases(phaseMap);
        })
        .catch(console.error);
    }, 6000);
    return () => clearInterval(interval);
  }, [selected]);

  const nodes = buildTaskNodes(tasks, pipelinePhases);
  const edges = buildEdges(tasks, pipelinePhases);

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

      {selected && tasks.length > 0 && (
        <Legend tasks={tasks} pipelinePhases={pipelinePhases} />
      )}
    </div>
  );
}
