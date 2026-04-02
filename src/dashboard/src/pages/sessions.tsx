import { useState, useEffect } from "react";
import { fetchSessions, type Task } from "../lib/api";
import { createSseClient } from "../lib/sse";
import {
  StatusBadge,
  StatusDot,
  PageHeader,
  EmptyState,
} from "../components/ui";

// ── Session card ──────────────────────────────────────────────────────────────

function SessionCard({ session }: { session: Task }) {
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
    <div className="flex flex-col h-full animate-fade-in">
      <PageHeader
        title="Active Sessions"
        description="Real-time agent execution monitor"
        actions={<LiveCounter count={sessions.length} />}
      />

      <div className="flex-1 overflow-y-auto p-6">
        {sessions.length === 0 ? (
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
            title="No active sessions"
            description="Sessions will appear here when tasks are running"
          />
        ) : (
          <div className="space-y-2.5">
            {sessions.map((session) => (
              <SessionCard key={session.id} session={session} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
