import { useState, useEffect } from "react";
import { fetchSessions, type Task } from "../lib/api";
import { createSseClient } from "../lib/sse";

const STATUS_COLORS: Record<string, string> = {
  running: "bg-blue-500",
  starting: "bg-yellow-500",
  provisioning: "bg-purple-500",
  checkpointing: "bg-orange-500",
  validating: "bg-indigo-500",
};

export function SessionsPage() {
  const [sessions, setSessions] = useState<Task[]>([]);

  useEffect(() => {
    fetchSessions().then(setSessions).catch(console.error);

    const cleanup = createSseClient((event) => {
      if (
        event.type === "session_start" ||
        event.type === "session_end" ||
        event.type === "token_update"
      ) {
        fetchSessions().then(setSessions).catch(console.error);
      }
    });

    return cleanup;
  }, []);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-white">Active Sessions</h2>
        <span className="text-sm text-gray-400">{sessions.length} active</span>
      </div>

      {sessions.length === 0 ? (
        <div className="text-gray-500 text-sm">No active sessions</div>
      ) : (
        <div className="space-y-3">
          {sessions.map((session) => (
            <SessionCard key={session.id} session={session} />
          ))}
        </div>
      )}
    </div>
  );
}

function SessionCard({ session }: { session: Task }) {
  const colorClass = STATUS_COLORS[session.status] ?? "bg-gray-500";
  return (
    <div className="bg-gray-800 rounded-lg p-4 space-y-2">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-white truncate">{session.description}</p>
          <p className="text-xs text-gray-400 mt-1 font-mono">
            {session.id.slice(0, 8)}
          </p>
        </div>
        <span
          className={`ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium text-white ${colorClass}`}
        >
          {session.status}
        </span>
      </div>
      <div className="flex gap-4 text-xs text-gray-400">
        {session.model && <span>Model: {session.model}</span>}
        <span>Tokens: {Number(session.tokensUsed).toLocaleString()}</span>
        <span>Cost: ${Number(session.costUsd).toFixed(4)}</span>
      </div>
    </div>
  );
}
