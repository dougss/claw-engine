import { useState, useEffect, useRef } from "react";
import { fetchLogs, type LogEntry } from "../lib/api";

export function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [taskFilter, setTaskFilter] = useState("");
  const [paused, setPaused] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = () => {
      fetchLogs(taskFilter || undefined)
        .then(setLogs)
        .catch(console.error);
    };
    load();
    if (!paused) {
      const interval = setInterval(load, 3000);
      return () => clearInterval(interval);
    }
    return undefined;
  }, [taskFilter, paused]);

  useEffect(() => {
    if (!paused) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, paused]);

  return (
    <div className="p-4 flex flex-col h-full space-y-3">
      <div className="flex items-center gap-3">
        <h2 className="text-xl font-semibold text-white">Logs</h2>
        <input
          className="ml-auto bg-gray-700 text-sm text-white px-3 py-1 rounded border border-gray-600 focus:outline-none"
          placeholder="Filter by task ID..."
          value={taskFilter}
          onChange={(e) => setTaskFilter(e.target.value)}
        />
        <button
          className={`px-3 py-1 rounded text-sm font-medium ${
            paused
              ? "bg-blue-600 text-white"
              : "bg-gray-700 text-gray-300 hover:bg-gray-600"
          }`}
          onClick={() => setPaused((p) => !p)}
        >
          {paused ? "Resume" : "Pause"}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto bg-gray-900 rounded-lg p-3 font-mono text-xs space-y-1 max-h-[60vh]">
        {logs.length === 0 && (
          <div className="text-gray-500">No log entries</div>
        )}
        {logs.map((entry) => (
          <div key={entry.id} className="flex gap-2 text-gray-300">
            <span className="text-gray-500 shrink-0">
              {new Date(entry.createdAt).toLocaleTimeString()}
            </span>
            <span className="text-blue-400 shrink-0">
              {entry.eventType ?? "event"}
            </span>
            {entry.taskId && (
              <span className="text-purple-400 shrink-0">
                {entry.taskId.slice(0, 8)}
              </span>
            )}
            <span className="truncate">
              {typeof entry.payload === "string"
                ? entry.payload
                : JSON.stringify(entry.payload)}
            </span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
