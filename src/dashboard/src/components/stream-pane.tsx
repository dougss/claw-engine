import { useRef, useEffect, useState } from "react";
import { type StreamEvent, filterEventsByPhase } from "../hooks/use-stream";
import { type TaskFull } from "../lib/api";
import { StreamEventComponent } from "./stream-event";
import { PipelineCards } from "./phase-bar";
import { PromptModal } from "./prompt-modal";

interface StreamPaneProps {
  task: TaskFull | null;
  events: StreamEvent[];
  isLive: boolean;
}

export const StreamPane = ({ task, events, isLive }: StreamPaneProps) => {
  const [selectedPhase, setSelectedPhase] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Reset selectedPhase and showPrompt when task changes
  useEffect(() => {
    setSelectedPhase(null);
    setShowPrompt(false);
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
  }, [filteredEvents, autoScroll]);

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
      {/* ZONE 1 — Compact header (shrink-0, border-b border-border, px-4 py-3) */}
      <div className="shrink-0 border-b border-border px-4 py-3">
        {task ? (
          <>
            <div className="flex items-center justify-between">
              <h2 className="text-text-primary font-medium text-sm truncate">
                {task.description.slice(0, 80)}
              </h2>
              <button 
                onClick={() => setShowPrompt(true)}
                className="text-accent text-xs cursor-pointer hover:underline shrink-0 ml-3"
              >
                Prompt
              </button>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span
                className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${getStatusClass(task.status)}`}
              >
                {task.status}
              </span>
              {task.model && (
                <span className="text-xs font-mono text-text-tertiary bg-surface-2 px-1.5 py-0.5 rounded">
                  {task.model}
                </span>
              )}
              <span className="text-text-tertiary text-xs">
                {getDuration()}
              </span>
              {isLive && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-accent/20 text-accent border border-accent/30">
                  LIVE
                </span>
              )}
            </div>
          </>
        ) : (
          <h2 className="text-text-tertiary font-medium text-sm">
            Select a task to view its output
          </h2>
        )}
      </div>

      {/* ZONE 2 — Pipeline cards (only if isPipeline) */}
      {isPipeline && (
        <PipelineCards 
          events={events}
          selectedPhase={selectedPhase}
          onSelectPhase={setSelectedPhase}
        />
      )}

      {/* ZONE 3 — Log viewer (flex-1 min-h-0 overflow-y-auto py-2) */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto py-2"
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
            <div className="opacity-50 p-4 text-text-tertiary text-center text-sm">
              Waiting for events...
            </div>
          )
        ) : (
          <div className="p-4 text-text-tertiary text-center text-sm">
            Select a task to view its output
          </div>
        )}
      </div>

      {/* Prompt modal */}
      {showPrompt && task && (
        <PromptModal 
          prompt={task.description} 
          onClose={() => setShowPrompt(false)} 
        />
      )}
    </div>
  );
};
