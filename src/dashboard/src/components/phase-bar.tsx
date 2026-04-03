import { extractPhaseEvents, getPhaseStatus, getRetryCount, PHASE_ORDER, PHASE_LABELS } from "../lib/pipeline";

interface PhaseEvent {
  type: string;
  timestamp: number;
  data: Record<string, unknown>;
}

interface PhaseBarProps {
  events: PhaseEvent[];
}

export function PhaseBar({ events }: PhaseBarProps) {
  const phaseEvents = extractPhaseEvents(events as any); // Cast to any to avoid type mismatch
  const currentPhase = (() => {
    const starts = phaseEvents.filter(p => p.eventType === 'phase_start');
    const ends = phaseEvents.filter(p => p.eventType === 'phase_end');
    const endedPhases = new Set(ends.map(e => e.phase));
    const active = starts.find(s => !endedPhases.has(s.phase));
    return active?.phase ?? null;
  })();
  
  const retryCount = getRetryCount(phaseEvents);

  return (
    <div className="h-12 flex items-center gap-1 px-4 border-b border-border bg-surface">
      <div className="flex items-center gap-1">
        {PHASE_ORDER.map((phase, index) => {
          const status = getPhaseStatus(phase as any, phaseEvents, currentPhase);
          
          // Determine colors based on status
          let circleColor, borderColor;
          switch (status) {
            case 'completed':
              circleColor = 'text-status-completed';
              borderColor = 'border-status-completed';
              break;
            case 'running':
              circleColor = 'text-status-running';
              borderColor = 'border-status-running';
              break;
            case 'failed':
              circleColor = 'text-status-failed';
              borderColor = 'border-status-failed';
              break;
            default: // pending
              circleColor = 'text-status-pending';
              borderColor = 'border-status-pending';
          }

          // Determine icon based on status
          let icon;
          switch (status) {
            case 'completed':
              icon = '✓';
              break;
            case 'failed':
              icon = '✗';
              break;
            case 'running':
              icon = (
                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              );
              break;
            default: // pending
              icon = '○';
          }

          return (
            <div key={phase} className="flex items-center">
              {/* Phase node */}
              <div className="flex flex-col items-center">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center ${circleColor} ${borderColor} border`}>
                  {typeof icon === 'string' ? (
                    <span className="text-xs">{icon}</span>
                  ) : (
                    icon
                  )}
                </div>
                <span className="text-xs mt-1 text-text-secondary">{PHASE_LABELS[phase]}</span>
              </div>

              {/* Connector line (except for the last phase) */}
              {index < PHASE_ORDER.length - 1 && (
                <div className={`w-8 h-0.5 ${status === 'completed' ? 'bg-status-completed' : 'bg-status-pending'}`} />
              )}
            </div>
          );
        })}

        {/* Retry count badge for execute phase if applicable */}
        {retryCount > 0 && (
          <div className="ml-2 text-xs bg-surface-2 px-2 py-1 rounded text-text-secondary">
            ×{retryCount}
          </div>
        )}
      </div>
    </div>
  );
}