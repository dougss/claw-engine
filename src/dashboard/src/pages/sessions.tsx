import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  fetchExecutions,
  fetchTaskWithTelemetry,
  type Execution,
  type TaskFull,
} from "../lib/api";
import { createSseClient } from "../lib/sse";
import {
  extractPhaseEvents,
  isPipelineRun,
  PHASE_LABELS,
  PHASE_COLORS,
  PHASE_ORDER,
  formatDuration,
  type PhaseEvent,
} from "../lib/pipeline";
import { PhaseBadges } from "../components/phase-timeline";
import {
  StatusBadge,
  StatusDot,
  PageHeader,
  EmptyState,
} from "../components/ui";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function fmtTokens(n: number): string {
  if (n === 0) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function fmtCost(s: string): string {
  const n = Number(s);
  if (n === 0) return "—";
  return `$${n.toFixed(4)}`;
}

function TypewriterStream({ taskId }: { taskId: string }) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cleanup = createSseClient((event) => {
      if (event.type === "text_delta") {
        const data = event.data as Record<string, unknown>;
        const chunk = (data?.text as string) ?? "";
        if (chunk) {
          setText((prev) => {
            const next = prev + chunk;
            return next.length > 2000 ? next.slice(-2000) : next;
          });
        }
      }
    });
    return cleanup;
  }, [taskId]);

  useEffect(() => {
    ref.current?.scrollTo({
      top: ref.current.scrollHeight,
      behavior: "smooth",
    });
  }, [text]);

  if (!text) return null;

  return (
    <div
      ref={ref}
      className="mt-3 p-3 rounded-lg border border-border max-h-32 overflow-y-auto"
      style={{ background: "rgba(5,10,15,0.6)" }}
    >
      <pre className="text-[10px] font-mono text-text-secondary whitespace-pre-wrap leading-relaxed">
        {text}
        <span className="typewriter-cursor" />
      </pre>
    </div>
  );
}

function PhaseTokenBreakdown({ phases }: { phases: PhaseEvent[] }) {
  const phaseEnds = phases.filter((p) => p.eventType === "phase_end");
  if (phaseEnds.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 mt-2 flex-wrap">
      {PHASE_ORDER.map((phase) => {
        const end = phaseEnds.find((p) => p.phase === phase);
        if (!end?.durationMs) return null;
        const colors = PHASE_COLORS[phase];
        return (
          <span
            key={phase}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-mono"
            style={{ background: colors.bg, color: colors.accent }}
          >
            {PHASE_LABELS[phase]}
            <span className="text-text-dim">
              {formatDuration(end.durationMs)}
            </span>
          </span>
        );
      })}
    </div>
  );
}

function TaskRow({ task, onLogs }: { task: TaskFull; onLogs: () => void }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2 border-t border-border/50">
      <StatusDot status={task.status} size={4} />
      <span className="font-mono text-[10px] text-text-dim w-[60px] shrink-0">
        {task.id.slice(0, 8)}
      </span>
      <span className="text-[11px] text-text-secondary flex-1 min-w-0 line-clamp-1">
        {task.description}
      </span>
      {task.model && (
        <span className="font-mono text-[9px] text-text-dim shrink-0 hidden sm:block">
          {task.model.split("/").pop()}
        </span>
      )}
      <button
        onClick={onLogs}
        className="shrink-0 font-mono text-[9px] text-text-dim hover:text-accent transition-colors cursor-pointer flex items-center gap-1"
      >
        logs
        <svg
          width="8"
          height="8"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <line x1="5" y1="12" x2="19" y2="12" />
          <polyline points="12 5 19 12 12 19" />
        </svg>
      </button>
    </div>
  );
}

function ExecutionCard({
  exec,
  onLogs,
  onDag,
  onPipeline,
}: {
  exec: Execution;
  onLogs: (taskId: string) => void;
  onDag: (wiId: string) => void;
  onPipeline: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [phases, setPhases] = useState<PhaseEvent[]>([]);
  const [hasPipeline, setHasPipeline] = useState(false);
  const firstTask = exec.tasks[0] as TaskFull | undefined;
  const model = firstTask?.model ?? null;
  const isActive = ["running", "starting", "provisioning"].includes(
    exec.status,
  );

  useEffect(() => {
    if (!firstTask) return;
    fetchTaskWithTelemetry(firstTask.id)
      .then((tw) => {
        const isPipe = isPipelineRun(tw.telemetry);
        setHasPipeline(isPipe);
        if (isPipe) setPhases(extractPhaseEvents(tw.telemetry));
      })
      .catch(() => {});
  }, [firstTask?.id]);

  return (
    <div
      className="rounded-xl border border-border-2 overflow-hidden transition-all duration-200 animate-fade-in"
      style={{
        background: "linear-gradient(135deg, #0a1628, #0d1b30)",
        borderColor: isActive ? "rgba(0,212,255,0.3)" : undefined,
        boxShadow: isActive
          ? "0 0 0 1px rgba(0,212,255,0.1), 0 4px 20px rgba(0,0,0,0.3)"
          : "0 2px 12px rgba(0,0,0,0.2)",
      }}
    >
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="mt-1 shrink-0">
            <StatusDot status={exec.status} size={5} />
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm text-text-primary font-medium leading-snug [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] overflow-hidden">
              {exec.title}
            </p>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className="font-mono text-[9px] text-text-dim tracking-widest">
                {exec.id.slice(0, 8)}
              </span>
              {model && (
                <>
                  <span className="text-border-3">·</span>
                  <span className="font-mono text-[9px] text-text-dim">
                    {model.split("/").pop()}
                  </span>
                </>
              )}
              <span className="text-border-3">·</span>
              <span className="font-mono text-[9px] text-text-dim">
                {timeAgo(exec.createdAt)}
              </span>
              {hasPipeline && (
                <>
                  <span className="text-border-3">·</span>
                  <PhaseBadges phases={phases} />
                </>
              )}
            </div>
            {hasPipeline && <PhaseTokenBreakdown phases={phases} />}
          </div>

          <StatusBadge status={exec.status} />
        </div>

        {isActive && firstTask && <TypewriterStream taskId={firstTask.id} />}

        <div className="mt-3 pt-3 border-t border-border flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="text-text-dim"
              >
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
              </svg>
              <span className="font-mono text-[10px] text-text-muted">
                {fmtTokens(exec.totalTokensUsed ?? 0)}
              </span>
            </span>
            <span
              className="font-mono text-[10px] font-semibold"
              style={{
                color: exec.totalTokensUsed > 0 ? "#39ff8c" : "#3a5068",
              }}
            >
              {fmtCost(exec.totalCostUsd ?? "0")}
            </span>
            {exec.tasksTotal > 0 && (
              <>
                <span className="text-border-3">·</span>
                <span className="font-mono text-[10px] text-text-dim">
                  {exec.tasksCompleted}/{exec.tasksTotal} tasks
                </span>
              </>
            )}
          </div>

          <div className="ml-auto flex items-center gap-2">
            {firstTask && (
              <button
                onClick={() => onLogs(firstTask.id)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border-3 font-mono text-[10px] text-text-dim hover:text-accent hover:border-accent/30 transition-all duration-150 cursor-pointer"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <polyline points="10 9 9 9 8 9" />
                </svg>
                Logs
              </button>
            )}
            {hasPipeline && (
              <button
                onClick={onPipeline}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg border font-mono text-[10px] transition-all duration-150 cursor-pointer"
                style={{
                  borderColor: "rgba(167,139,250,0.3)",
                  color: "#a78bfa",
                  background: "rgba(167,139,250,0.06)",
                }}
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <circle cx="6" cy="12" r="2" />
                  <circle cx="12" cy="12" r="2" />
                  <circle cx="18" cy="12" r="2" />
                </svg>
                Pipeline
              </button>
            )}
            <button
              onClick={() => onDag(exec.id)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border-3 font-mono text-[10px] text-text-dim hover:text-[#a78bfa] hover:border-[#a78bfa]/30 transition-all duration-150 cursor-pointer"
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="5" cy="12" r="2" />
                <circle cx="19" cy="5" r="2" />
                <circle cx="19" cy="19" r="2" />
                <line x1="7" y1="11.5" x2="17" y2="6.5" />
                <line x1="7" y1="12.5" x2="17" y2="17.5" />
              </svg>
              DAG
            </button>
            {exec.tasks.length > 1 && (
              <button
                onClick={() => setExpanded((e) => !e)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border-3 font-mono text-[10px] text-text-dim hover:text-text-primary hover:border-border-4 transition-all duration-150 cursor-pointer"
              >
                {exec.tasks.length} tasks
                <svg
                  width="9"
                  height="9"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className={`transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {expanded && exec.tasks.length > 1 && (
        <div style={{ background: "rgba(5,10,15,0.5)" }}>
          {exec.tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task as TaskFull}
              onLogs={() => onLogs(task.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ActiveBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg border"
      style={{
        background: "rgba(0,212,255,0.06)",
        borderColor: "rgba(0,212,255,0.2)",
      }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full bg-status-running status-pulse"
        style={{ boxShadow: "0 0 6px rgba(0,212,255,0.6)" }}
      />
      <span className="font-mono text-xs text-text-muted">{count} active</span>
    </div>
  );
}

export function SessionsPage() {
  const navigate = useNavigate();
  const [executions, setExecutions] = useState<Execution[]>([]);

  const reload = useCallback(() => {
    fetchExecutions().then(setExecutions).catch(console.error);
  }, []);

  useEffect(() => {
    reload();
    // SSE drives all updates — no polling interval needed
    return createSseClient((event) => {
      if (
        event.type === "session_start" ||
        event.type === "session_end" ||
        event.type === "token_update" ||
        event.type === "phase_start" ||
        event.type === "phase_end"
      ) {
        reload();
      }
    });
  }, [reload]);

  const activeCount = executions.filter((e) =>
    ["running", "starting", "provisioning"].includes(e.status),
  ).length;

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <PageHeader
        title="Executions"
        description="Agent run history"
        actions={<ActiveBadge count={activeCount} />}
      />

      <div className="flex-1 overflow-y-auto p-5 space-y-3">
        {executions.length === 0 ? (
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
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <polyline points="8 21 12 17 16 21" />
              </svg>
            }
            title="No executions yet"
            description='Run: npm run claw -- run <repo> "prompt"'
          />
        ) : (
          executions.map((exec) => (
            <ExecutionCard
              key={exec.id}
              exec={exec}
              onLogs={(taskId) => navigate(`/logs?task=${taskId}`)}
              onDag={(wiId) => navigate(`/dag?wi=${wiId}`)}
              onPipeline={() => navigate("/pipeline")}
            />
          ))
        )}
      </div>
    </div>
  );
}
