import { useState, useEffect } from "react";
import { fetchSessions, type Task } from "../lib/api";
import { createSseClient } from "../lib/sse";

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  string,
  { dot: string; badge: string; label: string }
> = {
  running: {
    dot: "bg-status-running status-pulse",
    badge: "text-status-running bg-status-running/10 border-status-running/20",
    label: "running",
  },
  starting: {
    dot: "bg-status-starting status-pulse",
    badge:
      "text-status-starting bg-status-starting/10 border-status-starting/20",
    label: "starting",
  },
  provisioning: {
    dot: "bg-status-provisioning",
    badge:
      "text-status-provisioning bg-status-provisioning/10 border-status-provisioning/20",
    label: "provisioning",
  },
  checkpointing: {
    dot: "bg-status-checkpointing",
    badge:
      "text-status-checkpointing bg-status-checkpointing/10 border-status-checkpointing/20",
    label: "checkpointing",
  },
  validating: {
    dot: "bg-status-validating",
    badge:
      "text-status-validating bg-status-validating/10 border-status-validating/20",
    label: "validating",
  },
};

const FALLBACK = {
  dot: "bg-text-dim",
  badge: "text-text-muted bg-surface-2 border-border-2",
  label: "unknown",
};

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
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-base font-semibold text-text-primary">
            Active Sessions
          </h1>
          <p className="text-xs text-text-muted mt-0.5">
            Real-time agent execution monitor
          </p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 bg-surface rounded-lg border border-border-2">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              sessions.length > 0
                ? "bg-status-running status-pulse"
                : "bg-text-dim"
            }`}
          />
          <span className="font-mono text-xs text-text-muted">
            {sessions.length} active
          </span>
        </div>
      </div>

      {/* Session list */}
      {sessions.length === 0 ? (
        <EmptyState />
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

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-10 h-10 rounded-xl bg-surface border border-border-2 flex items-center justify-center mb-3">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="text-text-dim"
        >
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <polyline points="8 21 12 17 16 21" />
        </svg>
      </div>
      <p className="text-sm font-medium text-text-primary">
        No active sessions
      </p>
      <p className="text-xs text-text-muted mt-1">
        Sessions will appear here when tasks are running
      </p>
    </div>
  );
}

// ── Session card ──────────────────────────────────────────────────────────────

function SessionCard({ session }: { session: Task }) {
  const cfg = STATUS_CONFIG[session.status] ?? FALLBACK;

  return (
    <div className="bg-surface rounded-xl border border-border-2 p-4 hover:border-border-2 transition-colors duration-150">
      <div className="flex items-start justify-between gap-3">
        {/* Left: description + id */}
        <div className="flex items-start gap-3 min-w-0">
          <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${cfg.dot}`} />
          <div className="min-w-0">
            <p className="text-sm text-text-primary leading-snug truncate">
              {session.description}
            </p>
            <p className="font-mono text-xs text-text-dim mt-1">
              {session.id.slice(0, 8)}
            </p>
          </div>
        </div>

        {/* Right: status badge */}
        <span
          className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium font-mono ${cfg.badge}`}
        >
          {session.status}
        </span>
      </div>

      {/* Footer: meta info */}
      <div className="mt-3 pt-3 border-t border-border flex items-center gap-4 text-xs text-text-muted">
        {session.model && (
          <span
            className="font-mono truncate max-w-[180px]"
            title={session.model}
          >
            {session.model}
          </span>
        )}
        <span className="ml-auto font-mono">
          {Number(session.tokensUsed).toLocaleString()} tok
        </span>
        <span className="font-mono text-accent">
          ${Number(session.costUsd).toFixed(4)}
        </span>
      </div>
    </div>
  );
}
