import {
  extractPhaseEvents,
  getPhaseStatus,
  getCurrentPhase,
  formatDuration,
  PHASE_ORDER,
  PHASE_LABELS,
} from "../lib/pipeline";
import type { PipelinePhase } from "../lib/api";
import type { StreamEvent } from "../hooks/use-stream";

interface PipelineCardsProps {
  events: StreamEvent[];
  selectedPhase: string | null;
  onSelectPhase: (phase: string | null) => void;
}

// Tailwind-safe color classes per phase (no inline styles)
const PHASE_THEME: Record<
  string,
  { text: string; border: string; bg: string; badgeBg: string }
> = {
  plan: {
    text: "text-[#a78bfa]",
    border: "border-[#a78bfa]/30",
    bg: "bg-[#a78bfa]/8",
    badgeBg: "bg-[#a78bfa]/20",
  },
  execute: {
    text: "text-[#00d4ff]",
    border: "border-[#00d4ff]/30",
    bg: "bg-[#00d4ff]/8",
    badgeBg: "bg-[#00d4ff]/20",
  },
  validate: {
    text: "text-[#818cf8]",
    border: "border-[#818cf8]/30",
    bg: "bg-[#818cf8]/8",
    badgeBg: "bg-[#818cf8]/20",
  },
  review: {
    text: "text-[#fb923c]",
    border: "border-[#fb923c]/30",
    bg: "bg-[#fb923c]/8",
    badgeBg: "bg-[#fb923c]/20",
  },
  pr: {
    text: "text-[#39ff8c]",
    border: "border-[#39ff8c]/30",
    bg: "bg-[#39ff8c]/8",
    badgeBg: "bg-[#39ff8c]/20",
  },
};

const STATUS_ICON: Record<string, { char: string; cls: string }> = {
  completed: { char: "✓", cls: "text-status-completed" },
  running: { char: "●", cls: "text-status-running animate-pulse" },
  failed: { char: "✗", cls: "text-status-failed" },
  pending: { char: "○", cls: "text-text-tertiary" },
  skipped: { char: "—", cls: "text-text-tertiary" },
};

export function PipelineCards({
  events,
  selectedPhase,
  onSelectPhase,
}: PipelineCardsProps) {
  const telemetryEvents = events.map((event) => ({
    id: event.id,
    taskId: "",
    eventType: event.type,
    data: event.data,
    createdAt: new Date(event.timestamp).toISOString(),
  }));

  const phaseEvents = extractPhaseEvents(telemetryEvents);
  const currentPhase = getCurrentPhase(phaseEvents);

  const getRetries = (phase: string) => {
    const starts = phaseEvents.filter(
      (pe) => pe.phase === phase && pe.eventType === "phase_start",
    ).length;
    return Math.max(0, starts - 1);
  };

  const getDuration = (phase: string) => {
    const end = phaseEvents.find(
      (pe) => pe.phase === phase && pe.eventType === "phase_end",
    );
    return end?.durationMs ? formatDuration(end.durationMs) : "—";
  };

  return (
    <div className="flex items-stretch gap-3 px-6 py-3 border-b border-border">
      <button
        onClick={() => onSelectPhase(null)}
        className={`shrink-0 px-4 py-3 rounded-lg border cursor-pointer transition-colors text-center text-xs font-bold uppercase tracking-wider ${
          selectedPhase === null
            ? "bg-accent/10 border-accent text-accent"
            : "border-border text-text-secondary hover:border-border-active"
        }`}
      >
        All
      </button>

      {PHASE_ORDER.map((phase) => {
        const status = getPhaseStatus(phase, phaseEvents, currentPhase);
        const retries = getRetries(phase);
        const duration = getDuration(phase);
        const theme = PHASE_THEME[phase] ?? PHASE_THEME.plan;
        const icon = STATUS_ICON[status] ?? STATUS_ICON.pending;
        const isSelected = selectedPhase === phase;
        const isPending = status === "pending";

        const cardCls = isSelected
          ? `bg-accent/10 border-accent`
          : isPending
            ? `border-border`
            : `${theme.bg} ${theme.border}`;

        const labelCls = isPending ? "text-text-tertiary" : theme.text;

        return (
          <div
            key={phase}
            onClick={() =>
              onSelectPhase(selectedPhase === phase ? null : phase)
            }
            className={`flex-1 rounded-lg border cursor-pointer transition-colors px-4 py-3 text-center ${cardCls}`}
          >
            <div className="flex items-center justify-center gap-1 mb-1">
              <span
                className={`text-xs uppercase tracking-wider font-bold ${labelCls}`}
              >
                {PHASE_LABELS[phase as PipelinePhase]}
              </span>
              {retries > 0 && (
                <span
                  className={`text-[10px] px-1 rounded ${theme.badgeBg} ${theme.text}`}
                >
                  x{retries + 1}
                </span>
              )}
            </div>
            <div className={`text-2xl my-1 ${icon.cls}`}>{icon.char}</div>
            <div className="text-xs text-text-tertiary">{duration}</div>
          </div>
        );
      })}
    </div>
  );
}
