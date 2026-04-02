import { useState, useEffect, useRef, useCallback } from "react";
import { fetchLogs, type LogEntry } from "../lib/api";
import { PageHeader } from "../components/ui";

// ── Event type colors ─────────────────────────────────────────────────────────

const EVENT_COLORS: Record<string, string> = {
  task_start: "#00d4ff",
  task_complete: "#39ff8c",
  task_failed: "#ff4d6d",
  session_start: "#a78bfa",
  session_end: "#818cf8",
  token_update: "#f59e0b",
  text_delta: "#5c7a9e",
  tool_call: "#fb923c",
  tool_result: "#fbbf24",
  validation_start: "#8b5cf6",
  validation_complete: "#39ff8c",
  error: "#ff4d6d",
};

const DEFAULT_EVENT_COLOR = "#5c7a9e";

function getEventColor(eventType: string): string {
  const type = eventType?.toLowerCase() ?? "";
  return EVENT_COLORS[type] ?? DEFAULT_EVENT_COLOR;
}

// ── Log row ───────────────────────────────────────────────────────────────────

function LogRow({ entry }: { entry: LogEntry }) {
  const color = getEventColor(entry.eventType ?? "");
  const payload =
    typeof entry.payload === "string"
      ? entry.payload
      : JSON.stringify(entry.payload);

  return (
    <div className="flex gap-3 items-baseline py-0.5 px-3 hover:bg-surface-2/40 transition-colors duration-100 animate-log-in group">
      <span className="font-mono text-[10px] text-text-dim shrink-0 w-[72px] text-right">
        {new Date(entry.createdAt).toLocaleTimeString("en-US", {
          hour12: false,
        })}
      </span>
      <span
        className="font-mono text-[10px] shrink-0 w-[120px] truncate font-medium uppercase tracking-wide"
        style={{ color }}
      >
        {entry.eventType ?? "event"}
      </span>
      {entry.taskId && (
        <span className="font-mono text-[10px] text-text-dim shrink-0 w-[60px]">
          {entry.taskId.slice(0, 8)}
        </span>
      )}
      <span className="font-mono text-[11px] text-text-secondary truncate leading-5 flex-1 min-w-0">
        {payload.length > 200 ? payload.slice(0, 197) + "…" : payload}
      </span>
    </div>
  );
}

// ── Filter bar ────────────────────────────────────────────────────────────────

function FilterBar({
  taskFilter,
  onFilterChange,
  paused,
  onTogglePause,
  count,
}: {
  taskFilter: string;
  onFilterChange: (v: string) => void;
  paused: boolean;
  onTogglePause: () => void;
  count: number;
}) {
  return (
    <div className="flex items-center gap-2.5 px-5 py-2.5 border-b border-border-2 bg-surface/20">
      <div className="relative flex-1 max-w-xs">
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-dim pointer-events-none"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          className="w-full bg-surface-2 border border-border-3 text-[11px] font-mono text-text-secondary pl-7 pr-3 py-1.5 rounded-lg focus:outline-none focus:border-accent/40 transition-colors duration-150 placeholder:text-text-dim hover:border-border-4"
          placeholder="Filter by task ID..."
          value={taskFilter}
          onChange={(e) => onFilterChange(e.target.value)}
        />
      </div>

      <div className="flex items-center gap-1.5 ml-auto">
        <span className="text-[10px] font-mono text-text-dim">
          {count} entries
        </span>
        <div className="w-px h-3.5 bg-border-3 mx-1" />
        <button
          onClick={onTogglePause}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[10px] font-mono transition-all duration-150 cursor-pointer"
          style={
            paused
              ? {
                  background: "rgba(0,212,255,0.08)",
                  borderColor: "rgba(0,212,255,0.25)",
                  color: "#00d4ff",
                }
              : {
                  background: "rgba(10,22,40,0.6)",
                  borderColor: "rgba(23,38,64,1)",
                  color: "#5c7a9e",
                }
          }
        >
          {paused ? (
            <>
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              Resume
            </>
          ) : (
            <>
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </svg>
              Pause
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [taskFilter, setTaskFilter] = useState("");
  const [paused, setPaused] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    fetchLogs(taskFilter || undefined)
      .then(setLogs)
      .catch(console.error);
  }, [taskFilter]);

  useEffect(() => {
    load();
    if (!paused) {
      const interval = setInterval(load, 3000);
      return () => clearInterval(interval);
    }
    return undefined;
  }, [load, paused]);

  useEffect(() => {
    if (!paused) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, paused]);

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <PageHeader title="Logs" description="Session telemetry stream" />

      <FilterBar
        taskFilter={taskFilter}
        onFilterChange={setTaskFilter}
        paused={paused}
        onTogglePause={() => setPaused((p) => !p)}
        count={logs.length}
      />

      {/* Header columns */}
      <div className="flex gap-3 items-center px-3 py-1.5 border-b border-border bg-surface/10">
        <span className="font-mono text-[9px] text-text-dim w-[72px] text-right uppercase tracking-widest">
          Time
        </span>
        <span className="font-mono text-[9px] text-text-dim w-[120px] uppercase tracking-widest">
          Event
        </span>
        <span className="font-mono text-[9px] text-text-dim w-[60px] uppercase tracking-widest">
          Task
        </span>
        <span className="font-mono text-[9px] text-text-dim flex-1 uppercase tracking-widest">
          Payload
        </span>
      </div>

      {/* Log stream */}
      <div
        className="flex-1 overflow-y-auto py-1"
        style={{
          background: "linear-gradient(180deg, #050a0f 0%, #0a1628 100%)",
        }}
      >
        {logs.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="font-mono text-xs text-text-dim">
              {taskFilter ? "No entries matching filter" : "No log entries"}
            </p>
          </div>
        ) : (
          logs.map((entry) => <LogRow key={entry.id} entry={entry} />)
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
