import { useRef, useEffect, useState } from "react";
import { type StreamEvent } from "../hooks/use-stream";
import { type TaskFull } from "../lib/api";
import { StreamEventComponent } from "./stream-event";
import { StepsBar } from "./phase-bar";
import { filterEventsByPhase } from "../hooks/use-stream";

interface StreamPaneProps {
  task: TaskFull | null;
  events: StreamEvent[];
  isLive: boolean;
}

export const StreamPane = ({ task, events, isLive }: StreamPaneProps) => {
  const [selectedPhase, setSelectedPhase] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Reset selectedPhase when task changes
  useEffect(() => {
    setSelectedPhase(null);
  }, [task?.id]);

  // Calculate duration if task has started
  const getDuration = () => {
    if (!task) return "";
    if (task.durationMs !== null) {
      return `${Math.round(task.durationMs / 1000)}s`;
    }

    if (task.createdAt) {
      const startTime = new Date(task.createdAt).getTime();
      const now = Date.now();
      const elapsed = Math.floor((now - startTime) / 1000);
      return `${elapsed}s`;
    }

    return "";
  };

  // Determine status badge class
  const getStatusClass = (status: string) => {
    switch (status) {
      case "running":
        return "bg-status-running/20 text-status-running border border-status-running/30";
      case "completed":
        return "bg-status-completed/20 text-status-completed border border-status-completed/30";
      case "failed":
        return "bg-status-failed/20 text-status-failed border border-status-failed/30";
      default:
        return "bg-status-pending/20 text-status-pending border border-status-pending/30";
    }
  };

  // Compute if pipeline run and filtered events
  const isPipeline = events.some(
    (e) => e.type === "phase_start" || e.type === "phase_end",
  );
  const filteredEvents = filterEventsByPhase(events, selectedPhase);

  // Handle auto-scroll behavior
  useEffect(() => {
    if (!scrollRef.current || !autoScroll) return;

    // Scroll to bottom when new events arrive
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [filteredEvents, autoScroll]); // Changed to filteredEvents

  // Handle manual scrolling - pause auto-scroll when user scrolls away from bottom
  const handleScroll = () => {
    if (!scrollRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 50; // 50px threshold

    if (atBottom) {
      setAutoScroll(true);
    } else {
      setAutoScroll(false);
    }
  };

  return (
    <div className="flex-1 h-full flex flex-col bg-bg overflow-hidden">
      {/* Zone 1: Prompt Card */}
      <div className="max-h-[15vh] shrink-0 overflow-hidden border-b border-border px-4 py-3">
        {task ? (
          <>
            <div className="flex items-center gap-2">
              <span
                className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${getStatusClass(task.status)}`}
              >
                {task.status}
              </span>
              {task.model && (
                <span className="text-xs font-mono text-text-tertiary bg-surface-2 px-1.5 py-0.5 rounded shrink-0">
                  {task.model}
                </span>
              )}
              <span className="text-text-tertiary text-xs shrink-0">
                {getDuration()}
              </span>
              {isLive && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-accent/20 text-accent border border-accent/30 shrink-0">
                  LIVE
                </span>
              )}
            </div>
            <div className="overflow-y-auto bg-surface-2/40 rounded border border-border px-3 py-2 mt-2">
              <p className="text-sm leading-relaxed whitespace-pre-wrap break-words text-text-primary">
                {task.description}
              </p>
            </div>
          </>
        ) : (
          <div className="text-text-tertiary text-sm">
            Select a task to view its output
          </div>
        )}
      </div>

      {/* Zone 2: Steps Bar (only if isPipeline) */}
      {isPipeline && (
        <StepsBar 
          events={events}
          selectedPhase={selectedPhase}
          onSelectPhase={setSelectedPhase}
        />
      )}

      {/* Zone 3: Log Viewer */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto"
      >
        {task ? (
          filteredEvents.length > 0 ? (
            filteredEvents.map((event, index) => (
              <StreamEventComponent
                key={`${event.id}-${index}`}
                event={event}
                now={Date.now()}
              />
            ))
          ) : (
            <div className="p-4 text-text-tertiary text-center text-sm">
              Waiting for events...
            </div>
          )
        ) : (
          <div className="p-4 text-text-tertiary text-center text-sm">
            Select a task to view its output
          </div>
        )}
      </div>
    </div>
  );
};
