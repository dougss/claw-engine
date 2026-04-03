import { 
  extractPhaseEvents, 
  getPhaseStatus, 
  getCurrentPhase, 
  formatDuration,
  PHASE_ORDER,
  PHASE_LABELS 
} from "../lib/pipeline";
import type { StreamEvent } from "../hooks/use-stream";

interface PipelineCardsProps {
  events: StreamEvent[];
  selectedPhase: string | null;
  onSelectPhase: (phase: string | null) => void;
}

export function PipelineCards({ events, selectedPhase, onSelectPhase }: PipelineCardsProps) {
  // Convert StreamEvent[] to the format expected by pipeline functions
  const telemetryEvents = events.map(event => ({
    id: event.id,
    taskId: '', // Not needed for phase extraction
    eventType: event.type,
    data: event.data,
    createdAt: new Date(event.timestamp).toISOString() // Convert timestamp back to ISO string
  }));

  const phaseEvents = extractPhaseEvents(telemetryEvents);
  const currentPhase = getCurrentPhase(phaseEvents);

  // Helper to get retry count for a specific phase
  const getPhaseRetryCount = (phase: string) => {
    const phaseStarts = phaseEvents.filter(pe => 
      pe.phase === phase && pe.eventType === "phase_start"
    ).length;
    return Math.max(0, phaseStarts - 1);
  };

  // Helper to get duration for a specific phase
  const getPhaseDuration = (phase: string) => {
    const phaseStart = phaseEvents.find(pe => pe.phase === phase && pe.eventType === "phase_start");
    const phaseEnd = phaseEvents.find(pe => pe.phase === phase && pe.eventType === "phase_end");
    
    if (phaseStart && phaseEnd && phaseEnd.durationMs) {
      return formatDuration(phaseEnd.durationMs);
    }
    return '—';
  };

  return (
    <div className="flex items-stretch gap-3 px-4 py-3 border-b border-border">
      {/* "All" button */}
      <button
        onClick={() => onSelectPhase(null)}
        className={`shrink-0 px-4 py-3 rounded-lg border cursor-pointer transition-colors text-center ${
          selectedPhase === null
            ? 'bg-accent/10 border-accent text-accent'
            : 'border-border text-text-secondary hover:border-border-active'
        }`}
      >
        All
      </button>

      {/* Phase cards */}
      {PHASE_ORDER.map((phase) => {
        const status = getPhaseStatus(phase, phaseEvents, currentPhase);
        const retryCount = getPhaseRetryCount(phase);
        const duration = getPhaseDuration(phase);
        
        // Determine icon based on status
        let icon;
        switch (status) {
          case 'completed':
            icon = (
              <span className="text-status-completed text-2xl my-1">✓</span>
            );
            break;
          case 'running':
            icon = (
              <span className="text-status-running text-2xl my-1 animate-pulse">●</span>
            );
            break;
          case 'failed':
            icon = (
              <span className="text-status-failed text-2xl my-1">✗</span>
            );
            break;
          default: // pending
            icon = (
              <span className="text-text-tertiary text-2xl my-1">○</span>
            );
        }

        // Determine border based on status
        let borderClass;
        switch (status) {
          case 'completed':
            borderClass = 'border-status-completed/30';
            break;
          case 'running':
            borderClass = 'border-status-running/30';
            break;
          case 'failed':
            borderClass = 'border-status-failed/30';
            break;
          default: // pending
            borderClass = 'border-border';
        }

        // Override with selected style if this phase is selected
        const isSelected = selectedPhase === phase;
        const cardBorderClass = isSelected ? 'bg-accent/10 border-accent' : borderClass;

        return (
          <div
            key={phase}
            onClick={() => onSelectPhase(selectedPhase === phase ? null : phase)}
            className={`flex-1 rounded-lg border cursor-pointer transition-colors px-4 py-3 text-center ${cardBorderClass}`}
          >
            <div className="flex items-center justify-center gap-1 mb-1">
              <div className="text-xs uppercase tracking-wider font-bold">
                {PHASE_LABELS[phase]}
              </div>
              {/* Retry badge if there are retries */}
              {retryCount > 0 && (
                <span className="text-[10px] px-1 rounded bg-status-running/20 text-status-running">
                  ×{retryCount + 1}
                </span>
              )}
            </div>
            {icon}
            <div className="text-xs text-text-tertiary">
              {duration}
            </div>
          </div>
        );
      })}
    </div>
  );
}