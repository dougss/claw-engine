import { useRef, useEffect, useState } from "react";
import { type StreamEvent } from "../hooks/use-stream";
import { type TaskFull } from "../lib/api";
import { StreamEventComponent } from "./stream-event";
import { PhaseBar } from "./phase-bar";

// Helper function to check if events come from a pipeline run
function isPipelineRunFromEvents(events: StreamEvent[]): boolean {
  return events.some(
    (event) => event.type === "phase_start" || event.type === "phase_end",
  );
}

interface StreamPaneProps {
  task: TaskFull | null;
  events: StreamEvent[];
  isLive: boolean;
}

export const StreamPane = ({ task, events, isLive }: StreamPaneProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Handle auto-scroll behavior
  useEffect(() => {
    if (!scrollRef.current || !autoScroll) return;

    // Scroll to bottom when new events arrive
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [events, autoScroll]);

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

  return (
    <div className="flex-1 h-full flex flex-col bg-bg">
      {/* Top bar */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        {task ? (
          <>
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <h2 className="text-text-primary text-sm font-medium truncate min-w-0 flex-1">
                {task.description}
              </h2>
              <span
                className={`text-xs px-2 py-0.5 rounded-full ${getStatusClass(task.status)}`}
              >
                {task.status}
              </span>
              <span className="text-text-tertiary text-xs">
                {getDuration()}
              </span>
              {isLive && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-accent/20 text-accent border border-accent/30">
                  LIVE
                </span>
              )}
            </div>
            {task.model && (
              <span className="text-xs font-mono text-text-tertiary bg-surface-2 px-1.5 py-0.5 rounded">
                {task.model}
              </span>
            )}
          </>
        ) : (
          <div className="text-text-tertiary text-sm">
            Select a task to view its output
          </div>
        )}
      </div>

      {/* Phase bar for pipeline runs */}
      {task && isPipelineRunFromEvents(events) && events.length > 0 && (
        <PhaseBar events={events as any} />
      )}

      {/* Stream area */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto"
      >
        {events.length > 0 ? (
          <div className="divide-y divide-border/30">
            {events.map((event, index) => (
              <StreamEventComponent
                key={`${event.id}-${index}`}
                event={event}
                now={Date.now()}
              />
            ))}
          </div>
        ) : task ? (
          <div className="p-4 text-text-tertiary text-center text-sm">
            No events to display yet...
          </div>
        ) : (
          <div className="p-4 text-text-tertiary text-center text-sm">
            Select a task to view its output
          </div>
        )}
      </div>
    </div>
  );
};
