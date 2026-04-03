import { extractPhaseEvents, getPhaseStatus, getCurrentPhase, PHASE_ORDER, PHASE_LABELS } from "../lib/pipeline";
import type { StreamEvent } from "../hooks/use-stream";

interface StepsBarProps {
  events: StreamEvent[];
  selectedPhase: string | null;
  onSelectPhase: (phase: string | null) => void;
}

export function StepsBar({ events: rawEvents, selectedPhase, onSelectPhase }: StepsBarProps) {
  // Convert StreamEvent[] to the format expected by pipeline functions
  const telemetryEvents = rawEvents.map(event => ({
    id: event.id,
    taskId: '', // Not needed for phase extraction
    eventType: event.type,
    data: event.data,
    createdAt: new Date(event.timestamp).toISOString() // Convert timestamp back to ISO string
  }));

  const phaseEvents = extractPhaseEvents(telemetryEvents);
  const currentPhase = getCurrentPhase(phaseEvents);

  return (
    <div className="h-12 flex items-center gap-0 px-4 border-b border-border bg-surface">
      {/* All button */}
      <button
        onClick={() => onSelectPhase(null)}
        className={`px-3 py-1 text-xs rounded cursor-pointer ${
          selectedPhase === null
            ? 'bg-accent/20 text-accent border border-accent/30'
            : 'text-text-secondary hover:text-text-primary'
        }`}
      >
        All
      </button>

      {PHASE_ORDER.map((phase, index) => {
        const status = getPhaseStatus(phase, phaseEvents, currentPhase);
        
        // Count retries for this specific phase
        const phaseStarts = phaseEvents.filter(pe => 
          pe.phase === phase && pe.eventType === "phase_start"
        ).length;
        const phaseRetryCount = Math.max(0, phaseStarts - 1);
        
        // Determine icon based on status
        let icon;
        switch (status) {
          case 'completed':
            icon = (
              <span className="text-status-completed text-xs">✓</span>
            );
            break;
          case 'running':
            icon = (
              <span className="text-status-running animate-pulse text-lg">●</span>
            );
            break;
          case 'failed':
            icon = (
              <span className="text-status-failed text-xs">✗</span>
            );
            break;
          default: // pending
            icon = (
              <span className="text-text-tertiary text-xs">○</span>
            );
        }

        return (
          <div key={phase} className="flex items-center">
            {/* Connector line: bg-status-completed if prev phase completed else bg-border */}
            {index > 0 && (
              <div 
                className={`w-6 h-px ${
                  getPhaseStatus(PHASE_ORDER[index - 1], phaseEvents, currentPhase) === 'completed' 
                    ? 'bg-status-completed' 
                    : 'bg-border'
                }`} 
              />
            )}
            
            {/* Phase node */}
            <div
              onClick={() => onSelectPhase(phase)}
              className={`
                flex items-center gap-1.5 px-2.5 py-1 rounded cursor-pointer transition-colors
                ${selectedPhase === phase
                  ? 'bg-accent/20 text-accent border border-accent/30'
                  : 'text-text-secondary hover:bg-surface-2'
                }
              `}
            >
              {icon}
              <span className="text-xs font-medium">{PHASE_LABELS[phase]}</span>
              
              {/* Retry badge if phase has retries */}
              {phaseRetryCount > 0 && (
                <span className="text-[10px] bg-status-running/20 text-status-running px-1 rounded">
                  ×{phaseRetryCount + 1}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}