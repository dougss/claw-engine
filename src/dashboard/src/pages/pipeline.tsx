import { useState, useEffect, useCallback, useRef, memo } from "react";
import {
  fetchExecutions,
  fetchTaskWithTelemetry,
  type Execution,
  type TaskWithTelemetry,
} from "../lib/api";
import { useSseSubscription } from "../lib/sse-context";
import {
  extractPhaseEvents,
  getCurrentPhase,
  formatDuration,
  PHASE_ORDER,
  PHASE_LABELS,
  PHASE_COLORS,
  getPhaseStatus,
  type PhaseEvent,
  getPhaseOutput,
  type PhaseOutput,
} from "../lib/pipeline";
import { PhaseTimeline } from "../components/phase-timeline";
import { PageHeader, StatusBadge, EmptyState } from "../components/ui";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

const RunListItem = memo(function RunListItem({
  execution,
  isSelected,
  onSelect,
}: {
  execution: Execution;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const isActive = ["running", "starting", "provisioning"].includes(
    execution.status,
  );

  return (
    <button
      onClick={onSelect}
      className="w-full text-left rounded-xl border p-4 transition-all duration-200 cursor-pointer"
      style={{
        background: isSelected
          ? "linear-gradient(135deg, #0d1b30, #0f2640)"
          : "linear-gradient(135deg, #0a1628, #0d1b30)",
        borderColor: isSelected
          ? "rgba(0,212,255,0.3)"
          : isActive
            ? "rgba(0,212,255,0.15)"
            : "rgba(15,31,53,1)",
        boxShadow: isSelected
          ? "0 0 0 1px rgba(0,212,255,0.1), 0 4px 20px rgba(0,0,0,0.3)"
          : isActive
            ? "0 0 0 1px rgba(0,212,255,0.05), 0 2px 12px rgba(0,0,0,0.2)"
            : "0 2px 12px rgba(0,0,0,0.2)",
      }}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-text-primary font-medium leading-snug [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] overflow-hidden">
            {execution.title}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <span className="font-mono text-[9px] text-text-dim">
              {execution.id.slice(0, 8)}
            </span>
            <span className="text-border-3">·</span>
            <span className="font-mono text-[9px] text-text-dim">
              {timeAgo(execution.createdAt)}
            </span>
          </div>
        </div>
        <StatusBadge status={execution.status} />
      </div>
    </button>
  );
});

const PhaseDetailPanel = memo(function PhaseDetailPanel({
  task,
  phases,
}: {
  task: TaskWithTelemetry;
  phases: PhaseEvent[];
}) {
  const currentPhase = getCurrentPhase(phases);
  const telemetry = task.telemetry;
  
  // Initialize state to auto-select first completed or current phase
  const [selectedPhase, setSelectedPhase] = useState(() => {
    // Find first completed phase
    const completedPhase = PHASE_ORDER.find(phase => 
      getPhaseStatus(phase, phases, currentPhase) === 'completed'
    );
    // If no completed phase, try current phase
    if (completedPhase) return completedPhase;
    if (currentPhase) return currentPhase;
    // Otherwise just pick the first phase
    return PHASE_ORDER[0];
  });
  
  const [showExecutionLogs, setShowExecutionLogs] = useState(false);
  const [showValidations, setShowValidations] = useState(true);

  // Get validation results
  const validationResults = telemetry.filter(
    (t) => t.eventType === "validation_result",
  );

  // Get phase output for selected phase
  const phaseOutput: PhaseOutput = getPhaseOutput(selectedPhase, telemetry);

  // Check if selected phase has been attempted
  const isPhaseAttempted = phases.some(p => 
    p.phase === selectedPhase && p.eventType === "phase_start"
  );

  // Extract PR URL if this is the PR phase
  let prUrl: string | null = null;
  if (selectedPhase === 'pr') {
    // Look for session_end events with GitHub URL in result
    for (const event of telemetry) {
      if (event.eventType === 'session_end') {
        const dataRecord = event.data as Record<string, unknown>;
        const result = dataRecord.result;
        if (typeof result === 'string' && result.includes('github.com')) {
          prUrl = result;
          break;
        }
      } else if (event.eventType === 'text_delta') {
        const dataRecord = event.data as Record<string, unknown>;
        const text = dataRecord.text;
        if (typeof text === 'string' && text.includes('github.com')) {
          prUrl = text;
          break;
        }
      }
    }
  }

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Section A: Interactive Phase Timeline */}
      <div
        className="rounded-xl border border-border-2 overflow-hidden"
        style={{ background: "linear-gradient(135deg, #0a1628, #0d1b30)" }}
      >
        <div className="px-5 py-3 border-b border-border-2">
          <h3 className="text-sm font-semibold text-text-primary">
            Phase Timeline
          </h3>
        </div>
        <div className="p-5">
          <PhaseTimeline phases={phases} />

          <div className="mt-5 grid grid-cols-5 gap-3">
            {PHASE_ORDER.map((phase) => {
              const status = getPhaseStatus(phase, phases, currentPhase);
              const colors = PHASE_COLORS[phase];
              const end = phases.find(
                (p) => p.phase === phase && p.eventType === "phase_end",
              );
              const attempts = phases.filter(
                (p) => p.phase === phase && p.eventType === "phase_start",
              ).length;

              const isSelected = selectedPhase === phase;

              return (
                <button
                  key={phase}
                  onClick={() => setSelectedPhase(phase)}
                  className="rounded-lg border p-3 space-y-1 transition-all duration-200 focus:outline-none"
                  style={{
                    background:
                      status !== "pending" ? colors.bg : "rgba(46,74,106,0.06)",
                    borderColor:
                      isSelected 
                        ? colors.accent 
                        : (status !== "pending" ? colors.border : "rgba(46,74,106,0.2)"),
                    opacity: status === "pending" ? 0.5 : 1,
                    boxShadow: isSelected 
                      ? `0 0 0 2px ${colors.accent}, 0 0 10px ${colors.glow}`
                      : "none",
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className="font-mono text-[9px] font-bold uppercase tracking-wider"
                      style={{
                        color: status !== "pending" ? colors.accent : "#2e4a6a",
                      }}
                    >
                      {PHASE_LABELS[phase]}
                    </span>
                    {status === "completed" && (
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke={colors.accent}
                        strokeWidth="3"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                    {status === "failed" && (
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#ff4d6d"
                        strokeWidth="3"
                      >
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    )}
                    {status === "running" && (
                      <span
                        className="w-1.5 h-1.5 rounded-full status-pulse"
                        style={{ backgroundColor: colors.accent }}
                      />
                    )}
                  </div>
                  {end?.durationMs !== undefined && (
                    <p className="font-mono text-[10px] text-text-muted">
                      {formatDuration(end.durationMs)}
                    </p>
                  )}
                  {attempts > 1 && (
                    <p
                      className="font-mono text-[9px]"
                      style={{ color: "#fb923c" }}
                    >
                      attempt {attempts}
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Section B: Phase Output */}
      <div
        className="rounded-xl border border-border-2 overflow-hidden"
        style={{ background: "linear-gradient(135deg, #0a1628, #0d1b30)" }}
      >
        <div className="px-5 py-3 border-b border-border-2">
          <h3 className="text-sm font-semibold text-text-primary">
            {selectedPhase === 'plan' ? 'Plan' : 
             selectedPhase === 'review' ? 'Review' : 
             selectedPhase === 'pr' ? 'Pull Request' : 
             'Output'}
          </h3>
        </div>
        <div className="p-4">
          {!isPhaseAttempted ? (
            <p className="font-mono text-xs text-text-dim italic">
              Select a phase to see its output
            </p>
          ) : (
            <>
              {/* Text Content */}
              {phaseOutput.textContent && (
                <div className="mb-4 max-h-80 overflow-y-auto">
                  <pre className="text-[11px] font-mono text-text-secondary whitespace-pre-wrap leading-relaxed">
                    {phaseOutput.textContent}
                  </pre>
                </div>
              )}

              {/* Tool Calls */}
              {phaseOutput.toolCalls.length > 0 && (
                <div className="mb-4">
                  <details className="group">
                    <summary className="cursor-pointer font-mono text-xs text-text-primary mb-2 flex items-center gap-2">
                      <span>Tool Calls ({phaseOutput.toolCalls.length})</span>
                      <svg 
                        className="w-3 h-3 transition-transform group-open:rotate-90" 
                        fill="none" 
                        stroke="currentColor" 
                        viewBox="0 0 24 24"
                      >
                        <polyline points="9 18 15 12 9 6"></polyline>
                      </svg>
                    </summary>
                    <div className="mt-2 space-y-2">
                      {phaseOutput.toolCalls.map((call, index) => (
                        <div 
                          key={index}
                          className="p-2 rounded border bg-bg-secondary text-xs font-mono"
                          style={{ 
                            borderColor: "rgba(15,31,53,0.5)",
                            background: "rgba(10,22,40,0.5)"
                          }}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <span 
                              className="text-xs font-mono font-bold"
                              style={{ color: PHASE_COLORS[selectedPhase].accent }}
                            >
                              {call.name}
                            </span>
                            <span className="text-text-dim text-[10px]">
                              {new Date(call.createdAt).toLocaleTimeString()}
                            </span>
                          </div>
                          <div className="text-text-secondary overflow-x-auto">
                            {JSON.stringify(call.input, null, 2)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              )}

              {/* PR URL */}
              {selectedPhase === 'pr' && prUrl && (
                <div className="mb-4">
                  <p className="font-mono text-xs text-text-primary mb-1">Pull Request URL:</p>
                  <a 
                    href={prUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="font-mono text-xs text-accent hover:underline break-all"
                  >
                    {prUrl}
                  </a>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Section C: Collapsible sections */}
      {/* Execution Logs */}
      <div
        className="rounded-xl border border-border-2 overflow-hidden"
        style={{ background: "linear-gradient(135deg, #0a1628, #0d1b30)" }}
      >
        <button
          className="w-full px-5 py-3 border-b border-border-2 flex items-center justify-between focus:outline-none"
          onClick={() => setShowExecutionLogs(!showExecutionLogs)}
          style={{ background: "transparent" }}
        >
          <h3 className="text-sm font-semibold text-text-primary">
            Execution Logs
          </h3>
          <div className="flex items-center gap-3">
            <span className="font-mono text-[9px] text-text-dim">
              {phaseOutput.toolCalls.length} events
            </span>
            <svg 
              className={`w-4 h-4 transition-transform ${showExecutionLogs ? 'rotate-90' : ''}`} 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </div>
        </button>
        
        {showExecutionLogs && (
          <div className="p-4 max-h-64 overflow-y-auto">
            {phaseOutput.toolCalls.length > 0 ? (
              <div className="divide-y" style={{ borderColor: "rgba(15,31,53,0.5)" }}>
                {phaseOutput.toolCalls.map((call, index) => (
                  <div key={index} className="py-2.5 font-mono text-xs">
                    <div className="flex items-center gap-2 mb-1">
                      <span 
                        className="font-mono font-bold"
                        style={{ color: PHASE_COLORS[selectedPhase].accent }}
                      >
                        [{call.name}]
                      </span>
                      <span className="text-text-dim truncate">
                        {JSON.stringify(call.input).substring(0, 60)}
                        {JSON.stringify(call.input).length > 60 && '...'}
                      </span>
                    </div>
                    <div className="text-[9px] text-text-dim ml-2">
                      {new Date(call.createdAt).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="font-mono text-xs text-text-dim italic">
                No execution logs for this phase
              </p>
            )}
          </div>
        )}
      </div>

      {/* Validations */}
      {(validationResults.length > 0 || phaseOutput.validations.length > 0) && (
        <div
          className="rounded-xl border border-border-2 overflow-hidden"
          style={{ background: "linear-gradient(135deg, #0a1628, #0d1b30)" }}
        >
          <button
            className="w-full px-5 py-3 border-b border-border-2 flex items-center justify-between focus:outline-none"
            onClick={() => setShowValidations(!showValidations)}
            style={{ background: "transparent" }}
          >
            <h3 className="text-sm font-semibold text-text-primary">
              Validations
            </h3>
            <svg 
              className={`w-4 h-4 transition-transform ${showValidations ? 'rotate-90' : ''}`} 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </button>
          
          {showValidations && (
            <div className="p-4 space-y-2">
              {validationResults.map((vr, vi) => {
                const data = vr.data as Record<string, unknown>;
                const passed = data.passed === true;
                const steps = Array.isArray(data.steps)
                  ? (data.steps as Array<{
                      name: string;
                      passed: boolean;
                      output: string;
                      durationMs: number;
                    }>)
                  : [];
                return (
                  <div key={vi} className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span
                        className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded-md"
                        style={{
                          background: passed
                            ? "rgba(57,255,140,0.1)"
                            : "rgba(255,77,109,0.1)",
                          color: passed ? "#39ff8c" : "#ff4d6d",
                        }}
                      >
                        {passed ? "PASS" : "FAIL"}
                      </span>
                      <span className="text-[10px] font-mono text-text-dim">
                        attempt {vi + 1}
                      </span>
                    </div>
                    {steps.map((step, si) => (
                      <div
                        key={si}
                        className="flex items-center gap-2 pl-3 py-1 rounded-lg"
                        style={{
                          background: step.passed
                            ? "rgba(57,255,140,0.04)"
                            : "rgba(255,77,109,0.04)",
                        }}
                      >
                        <span className="shrink-0">
                          {step.passed ? (
                            <svg
                              width="10"
                              height="10"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="#39ff8c"
                              strokeWidth="2.5"
                            >
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          ) : (
                            <svg
                              width="10"
                              height="10"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="#ff4d6d"
                              strokeWidth="2.5"
                            >
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          )}
                        </span>
                        <span className="text-[11px] font-mono text-text-secondary flex-1 min-w-0 truncate">
                          {step.name}
                        </span>
                        <span className="text-[9px] font-mono text-text-dim shrink-0">
                          {formatDuration(step.durationMs)}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

function ActiveRunCounter({ count }: { count: number }) {
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

const PIPELINE_SSE_EVENTS = new Set([
  "phase_start",
  "phase_end",
  "session_start",
  "session_end",
  "validation_result",
]);

export function PipelinePage() {
  const [runs, setRuns] = useState<Execution[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<TaskWithTelemetry | null>(
    null,
  );
  const [selectedPhases, setSelectedPhases] = useState<PhaseEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingSelected, setLoadingSelected] = useState(false);

  const selectedIdRef = useRef(selectedId);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const runsRef = useRef<Execution[]>([]);

  const loadRuns = useCallback(async () => {
    try {
      const executions = await fetchExecutions(30);
      runsRef.current = executions;
      setRuns(executions);
      if (selectedIdRef.current === null && executions.length > 0) {
        setSelectedId(executions[0].id);
      }
    } catch (err) {
      console.error("Failed to load pipeline runs:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSelectedTask = useCallback(async (executionId: string) => {
    const exec = runsRef.current.find((r) => r.id === executionId);
    const firstTask = exec?.tasks[0];
    if (!firstTask) return;
    setLoadingSelected(true);
    try {
      const tw = await fetchTaskWithTelemetry(firstTask.id);
      setSelectedTask(tw);
      setSelectedPhases(extractPhaseEvents(tw.telemetry));
    } catch (err) {
      console.error("Failed to load task telemetry:", err);
    } finally {
      setLoadingSelected(false);
    }
  }, []);

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    if (selectedId) {
      loadSelectedTask(selectedId);
    } else {
      setSelectedTask(null);
      setSelectedPhases([]);
    }
  }, [selectedId, loadSelectedTask]);

  useSseSubscription((event) => {
    if (PIPELINE_SSE_EVENTS.has(event.type)) {
      loadRuns();
      if (selectedIdRef.current) {
        loadSelectedTask(selectedIdRef.current);
      }
    }
  });

  const activeCount = runs.filter((r) =>
    ["running", "starting", "provisioning"].includes(r.status),
  ).length;

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <PageHeader
        title="Pipeline"
        description="Real-time phase tracking"
        actions={<ActiveRunCounter count={activeCount} />}
      />

      <div className="flex-1 flex min-h-0 overflow-hidden">
        <div className="w-[360px] shrink-0 border-r border-border-2 overflow-y-auto p-3 space-y-2">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <span className="inline-block w-5 h-5 rounded-full border-2 border-accent/20 border-t-accent animate-spin-slow" />
            </div>
          ) : runs.length === 0 ? (
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
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
              }
              title="No pipeline runs"
              description='Run: npm run claw -- run <repo> "prompt" --pipeline'
            />
          ) : (
            runs.map((exec) => (
              <RunListItem
                key={exec.id}
                execution={exec}
                isSelected={selectedId === exec.id}
                onSelect={() => setSelectedId(exec.id)}
              />
            ))
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loadingSelected ? (
            <div className="flex items-center justify-center h-full">
              <span className="inline-block w-5 h-5 rounded-full border-2 border-accent/20 border-t-accent animate-spin-slow" />
            </div>
          ) : selectedTask ? (
            <PhaseDetailPanel task={selectedTask} phases={selectedPhases} />
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="font-mono text-xs text-text-dim">
                {runs.length > 0
                  ? "Select a run to view details"
                  : "No pipeline runs to display"}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
