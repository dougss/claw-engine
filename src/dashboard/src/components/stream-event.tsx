import React from "react";
import type { StreamEvent } from "../hooks/use-stream";

interface StreamEventProps {
  event: StreamEvent;
  now: number;
}

const formatTime = (now: number, timestamp: number): string => {
  const diff = now - timestamp;
  if (diff < 60000) return `${Math.max(0, Math.floor(diff / 1000))}s`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  return `${Math.floor(diff / 3600000)}h`;
};

const formatTokens = (n: number): string => {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
};

/** Pretty-print tool input: extract the most relevant field as a short preview */
function formatToolInput(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const obj = input as Record<string, unknown>;

  // Common patterns: show the most meaningful field
  if (typeof obj.filePath === "string") return obj.filePath as string;
  if (typeof obj.file_path === "string") return obj.file_path as string;
  if (typeof obj.path === "string") return obj.path as string;
  if (typeof obj.command === "string") {
    const cmd = obj.command as string;
    return cmd.length > 80 ? cmd.slice(0, 77) + "..." : cmd;
  }
  if (typeof obj.pattern === "string") return obj.pattern as string;
  if (typeof obj.query === "string") return obj.query as string;
  if (typeof obj.content === "string")
    return (obj.content as string).slice(0, 60) + "...";

  // Fallback: compact JSON, truncated
  const json = JSON.stringify(obj);
  return json.length > 80 ? json.slice(0, 77) + "..." : json;
}

const Timestamp: React.FC<{ now: number; ts: number }> = ({ now, ts }) => (
  <span className="text-xs font-mono text-text-tertiary w-12 shrink-0 text-right">
    {formatTime(now, ts)}
  </span>
);

const Row: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = "",
}) => (
  <div className={`flex items-start gap-3 px-4 py-1.5 ${className}`}>
    {children}
  </div>
);

const StreamEventComponent: React.FC<StreamEventProps> = ({ event, now }) => {
  const { type, timestamp, data } = event;

  switch (type) {
    case "heartbeat":
      return null;

    case "tool_use": {
      const name = (data.name as string) || "";
      const preview = formatToolInput(data.input);

      return (
        <Row>
          <Timestamp now={now} ts={timestamp} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-stream-tool font-mono text-xs font-medium">
                {name}
              </span>
            </div>
            {preview && (
              <div className="font-mono text-xs text-text-secondary mt-0.5 truncate">
                {preview}
              </div>
            )}
          </div>
        </Row>
      );
    }

    case "text_delta": {
      const text = (data.text as string) || "";
      if (!text.trim()) return null;

      return (
        <Row>
          <Timestamp now={now} ts={timestamp} />
          <div className="text-sm text-stream-text whitespace-pre-wrap min-w-0 flex-1">
            {text}
          </div>
        </Row>
      );
    }

    case "token_update": {
      const percent = data.percent as number | undefined;
      if (typeof percent !== "number") return null;

      const used = (data.used as number) || 0;
      const budget = (data.budget as number) || 0;

      return (
        <Row className="opacity-50">
          <Timestamp now={now} ts={timestamp} />
          <div className="text-stream-token font-mono text-xs">
            ⬡ {percent}% — {formatTokens(used)} / {formatTokens(budget)}
          </div>
        </Row>
      );
    }

    case "session_end": {
      const reason = (data.reason as string) || "unknown";
      const isSuccess = reason === "completed";
      const isFailed = reason === "error" || reason === "failed";

      const bg = isSuccess
        ? "bg-status-completed/10 border-status-completed/20"
        : isFailed
          ? "bg-status-failed/10 border-status-failed/20"
          : "bg-status-running/10 border-status-running/20";
      const text = isSuccess
        ? "text-status-completed"
        : isFailed
          ? "text-status-failed"
          : "text-status-running";
      const icon = isSuccess ? "✓" : isFailed ? "✗" : "⏹";

      return (
        <div className={`mx-4 my-2 px-4 py-2 rounded border ${bg}`}>
          <span className={`text-sm font-medium ${text}`}>
            {icon} Session {reason}
          </span>
        </div>
      );
    }

    case "routing_decision": {
      const mode = (data.mode as string) || "";
      const reason = (data.reason as string) || "";
      const complexity = (data.complexity as string) || "";

      return (
        <Row className="opacity-40">
          <Timestamp now={now} ts={timestamp} />
          <div className="text-xs">
            ⟶ {mode} · {complexity}
            {reason ? ` · ${reason}` : ""}
          </div>
        </Row>
      );
    }

    case "phase_start": {
      const phase = ((data.phase as string) || "").toUpperCase();
      const attempt = data.attempt as number | undefined;

      return (
        <div className="mx-4 my-1 px-3 py-1.5 rounded bg-accent/10 border border-accent/20">
          <span className="text-accent text-sm font-medium">
            ▶ {phase}
            {attempt && attempt > 1 ? ` (attempt ${attempt})` : ""}
          </span>
        </div>
      );
    }

    case "phase_end": {
      const phase = ((data.phase as string) || "").toUpperCase();
      const success = data.success !== false;
      const durationMs = data.durationMs as number | undefined;
      const duration =
        durationMs !== undefined ? ` (${(durationMs / 1000).toFixed(1)}s)` : "";

      return (
        <div
          className={`mx-4 my-1 px-3 py-1.5 rounded border ${
            success
              ? "bg-status-completed/10 border-status-completed/20"
              : "bg-status-failed/10 border-status-failed/20"
          }`}
        >
          <span
            className={`text-sm font-medium ${success ? "text-status-completed" : "text-status-failed"}`}
          >
            {success ? "✓" : "✗"} {phase}
            {duration}
          </span>
        </div>
      );
    }

    default:
      return null;
  }
};

export { StreamEventComponent };
