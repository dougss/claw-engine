import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { fetchSessions, fetchAllTasks, type TaskFull } from "../lib/api";
import { createSseClient } from "../lib/sse";
import {
  StatusBadge,
  StatusDot,
  PageHeader,
  EmptyState,
} from "../components/ui";

// ── Session card ──────────────────────────────────────────────────────────────

function SessionCard({
  session,
  onViewLogs,
}: {
  session: TaskFull;
  onViewLogs: (id: string) => void;
}) {
  const tokensK = (Number(session.tokensUsed) / 1000).toFixed(1);
  const cost = Number(session.costUsd).toFixed(4);

  return (
    <div
      className="group rounded-xl border border-border-2 p-4 hover:border-border-4 transition-all duration-200 animate-fade-in cursor-default inset-border"
      style={{ background: "linear-gradient(135deg, #0a1628, #0f1f35)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="mt-0.5 shrink-0">
            <StatusDot status={session.status} size={5} />
          </div>
          <div className="min-w-0">
            <p className="text-sm text-text-primary leading-snug truncate font-medium">
              {session.description}
            </p>
            <p className="font-mono text-[10px] text-text-dim mt-1 tracking-widest">
              {session.id.slice(0, 8)}…
            </p>
          </div>
        </div>
        <StatusBadge status={session.status} />
      </div>

      {/* Footer */}
      <div className="mt-3.5 pt-3 border-t border-border flex items-center gap-3">
        {session.model && (
          <div className="flex items-center gap-1.5 min-w-0">
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-text-dim shrink-0"
            >
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
            <span
              className="font-mono text-[10px] text-text-muted truncate max-w-[160px]"
              title={session.model}
            >
              {session.model}
            </span>
          </div>
        )}
        <div className="ml-auto flex items-center gap-3">
          <span className="flex items-center gap-1">
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-text-dim"
            >
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
            </svg>
            <span className="font-mono text-[10px] text-text-muted">
              {tokensK}k tok
            </span>
          </span>
          <span
            className="font-mono text-[10px] font-semibold"
            style={{ color: "#39ff8c" }}
          >
            ${cost}
          </span>
          <button
            onClick={() => onViewLogs(session.id)}
            className="ml-auto flex items-center gap-1 font-mono text-[10px] text-text-dim hover:text-accent transition-colors duration-150 cursor-pointer"
          >
            logs
            <svg
              width="9"
              height="9"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Live counter badge ────────────────────────────────────────────────────────

function LiveCounter({ count }: { count: number }) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg border"
      style={{
        background: count > 0 ? "rgba(0,212,255,0.06)" : "rgba(10,22,40,0.8)",
        borderColor: count > 0 ? "rgba(0,212,255,0.2)" : "rgba(23,38,64,1)",
      }}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${count > 0 ? "bg-status-running status-pulse" : "bg-text-dim"}`}
        style={
          count > 0 ? { boxShadow: "0 0 6px rgba(0,212,255,0.6)" } : undefined
        }
      />
      <span className="font-mono text-xs text-text-muted">{count} active</span>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function SessionsPage() {
  const navigate = useNavigate();
  const [activeSessions, setActiveSessions] = useState<TaskFull[]>([]);
  const [allTasks, setAllTasks] = useState<TaskFull[]>([]);

  const reload = () => {
    fetchSessions().then(setActiveSessions).catch(console.error);
    fetchAllTasks().then(setAllTasks).catch(console.error);
  };

  useEffect(() => {
    reload();

    const cleanup = createSseClient((event) => {
      if (
        event.type === "session_start" ||
        event.type === "session_end" ||
        event.type === "token_update"
      ) {
        reload();
      }
    });

    // Refresh all tasks every 10s
    const interval = setInterval(
      () => fetchAllTasks().then(setAllTasks).catch(console.error),
      10000,
    );

    return () => {
      cleanup();
      clearInterval(interval);
    };
  }, []);

  // Show active sessions at top, then recent completed/failed below
  const inactiveTasks = allTasks.filter(
    (t) => !activeSessions.find((s) => s.id === t.id),
  );

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <PageHeader
        title="Sessions"
        description="Agent task history"
        actions={<LiveCounter count={activeSessions.length} />}
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Active sessions section */}
        {activeSessions.length > 0 && (
          <div>
            <p className="text-[10px] font-mono text-text-dim uppercase tracking-widest mb-3">
              Active
            </p>
            <div className="space-y-2.5">
              {activeSessions.map((session) => (
                <SessionCard
                  key={session.id}
                  session={session}
                  onViewLogs={(id) => navigate(`/logs?task=${id}`)}
                />
              ))}
            </div>
          </div>
        )}

        {/* History section */}
        {inactiveTasks.length > 0 ? (
          <div>
            <p className="text-[10px] font-mono text-text-dim uppercase tracking-widest mb-3">
              Recent
            </p>
            <div className="space-y-2.5">
              {inactiveTasks.map((task) => (
                <SessionCard
                  key={task.id}
                  session={task}
                  onViewLogs={(id) => navigate(`/logs?task=${id}`)}
                />
              ))}
            </div>
          </div>
        ) : activeSessions.length === 0 ? (
          <EmptyState
            icon={
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <polyline points="8 21 12 17 16 21" />
              </svg>
            }
            title="No sessions yet"
            description='Run a task with: npm run claw -- run &lt;repo&gt; "prompt"'
          />
        ) : null}
      </div>
    </div>
  );
}
