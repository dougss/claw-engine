import {
  PHASE_ORDER,
  PHASE_LABELS,
  PHASE_COLORS,
  getPhaseStatus,
  getCurrentPhase,
  formatDuration,
  type PhaseEvent,
  type PhaseStatus,
} from "../lib/pipeline";
import type { PipelinePhase } from "../lib/api";

interface PhaseTimelineProps {
  phases: PhaseEvent[];
  compact?: boolean;
}

function PhaseBlock({
  phase,
  status,
  durationMs,
  attempt,
  compact,
}: {
  phase: PipelinePhase;
  status: PhaseStatus;
  durationMs?: number;
  attempt?: number;
  compact?: boolean;
}) {
  const colors = PHASE_COLORS[phase];
  const isActive = status === "running";
  const isDone = status === "completed";
  const isFailed = status === "failed";
  const isPending = status === "pending";

  return (
    <div className="flex flex-col items-center gap-1 relative">
      <div
        className={`rounded-lg border transition-all duration-200 flex items-center justify-center ${isActive ? "phase-pulse" : ""} ${compact ? "px-2 py-1" : "px-3 py-1.5"}`}
        style={{
          background: isPending ? "rgba(46,74,106,0.15)" : colors.bg,
          borderColor: isPending
            ? "rgba(46,74,106,0.3)"
            : isFailed
              ? "rgba(255,77,109,0.4)"
              : colors.border,
          opacity: isPending ? 0.4 : 1,
          ["--phase-glow" as string]: colors.glow,
          boxShadow: isActive ? `0 0 8px ${colors.glow}` : "none",
        }}
      >
        <span
          className={`font-mono font-medium tracking-wider uppercase ${compact ? "text-[9px]" : "text-[10px]"}`}
          style={{
            color: isPending ? "#2e4a6a" : isFailed ? "#ff4d6d" : colors.accent,
          }}
        >
          {PHASE_LABELS[phase]}
        </span>
        {isDone && (
          <svg
            width={compact ? "8" : "10"}
            height={compact ? "8" : "10"}
            viewBox="0 0 24 24"
            fill="none"
            stroke={colors.accent}
            strokeWidth="3"
            className="ml-1"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
        {isFailed && (
          <svg
            width={compact ? "8" : "10"}
            height={compact ? "8" : "10"}
            viewBox="0 0 24 24"
            fill="none"
            stroke="#ff4d6d"
            strokeWidth="3"
            className="ml-1"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        )}
        {isActive && (
          <span
            className="ml-1.5 w-1.5 h-1.5 rounded-full status-pulse"
            style={{ backgroundColor: colors.accent }}
          />
        )}
      </div>
      {!compact && durationMs !== undefined && durationMs > 0 && (
        <span className="text-[9px] font-mono text-text-dim">
          {formatDuration(durationMs)}
        </span>
      )}
      {attempt !== undefined && attempt > 1 && (
        <span
          className="absolute -top-1.5 -right-1.5 text-[8px] font-mono font-bold px-1 rounded-full"
          style={{
            background: "rgba(251,146,60,0.2)",
            color: "#fb923c",
            border: "1px solid rgba(251,146,60,0.4)",
          }}
        >
          ×{attempt}
        </span>
      )}
    </div>
  );
}

function Connector({ active }: { active: boolean }) {
  return (
    <div className="flex items-center">
      <div
        className={`h-px transition-all duration-300 ${active ? "w-4" : "w-3"}`}
        style={{
          background: active
            ? "linear-gradient(90deg, rgba(0,212,255,0.6), rgba(57,255,140,0.6))"
            : "rgba(46,74,106,0.4)",
        }}
      />
      {active && (
        <div
          className="w-1 h-1 rounded-full"
          style={{ background: "rgba(0,212,255,0.6)" }}
        />
      )}
    </div>
  );
}

export function PhaseTimeline({ phases, compact = false }: PhaseTimelineProps) {
  const currentPhase = getCurrentPhase(phases);

  const phaseEndMap = new Map<string, PhaseEvent>();
  for (const p of phases) {
    if (p.eventType === "phase_end") {
      phaseEndMap.set(p.phase, p);
    }
  }

  const attemptMap = new Map<string, number>();
  for (const p of phases) {
    if (p.eventType === "phase_start") {
      attemptMap.set(
        p.phase,
        Math.max(attemptMap.get(p.phase) ?? 0, p.attempt),
      );
    }
  }

  return (
    <div className="flex items-center gap-0.5">
      {PHASE_ORDER.map((phase, i) => {
        const status = getPhaseStatus(phase, phases, currentPhase);
        const end = phaseEndMap.get(phase);
        const maxAttempt = attemptMap.get(phase);
        const prevStatus =
          i > 0
            ? getPhaseStatus(PHASE_ORDER[i - 1], phases, currentPhase)
            : null;
        const connectorActive =
          prevStatus === "completed" || prevStatus === "running";
        return (
          <div key={phase} className="flex items-center gap-0.5">
            {i > 0 && <Connector active={connectorActive} />}
            <PhaseBlock
              phase={phase}
              status={status}
              durationMs={end?.durationMs}
              attempt={maxAttempt}
              compact={compact}
            />
          </div>
        );
      })}
    </div>
  );
}

export function PhaseBadges({ phases }: { phases: PhaseEvent[] }) {
  const currentPhase = getCurrentPhase(phases);
  return (
    <div className="flex items-center gap-0.5">
      {PHASE_ORDER.map((phase) => {
        const status = getPhaseStatus(phase, phases, currentPhase);
        const colors = PHASE_COLORS[phase];
        const isPending = status === "pending";
        const isFailed = status === "failed";
        const isActive = status === "running";
        return (
          <span
            key={phase}
            className={`inline-block rounded-sm font-mono text-[7px] font-bold px-1 py-0.5 uppercase tracking-wider ${isActive ? "status-pulse" : ""}`}
            style={{
              background: isPending ? "rgba(46,74,106,0.1)" : colors.bg,
              color: isPending
                ? "#2e4a6a"
                : isFailed
                  ? "#ff4d6d"
                  : colors.accent,
              opacity: isPending ? 0.4 : 1,
            }}
          >
            {PHASE_LABELS[phase].charAt(0)}
          </span>
        );
      })}
    </div>
  );
}
