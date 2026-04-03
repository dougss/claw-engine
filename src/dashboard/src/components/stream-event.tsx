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

const StreamEventComponent: React.FC<StreamEventProps> = ({ event, now }) => {
  const { type, timestamp, data } = event;

  switch (type) {
    case "heartbeat":
      return null;

    case "tool_use": {
      const name = (data.name as string) || "";
      const preview = formatToolInput(data.input);

      return (
        <div className="bg-surface-2 border-l-4 border-accent rounded-r px-3 py-2 mx-2 my-1">
          <div className="flex justify-between items-center">
            <span className="text-accent font-mono font-bold text-sm">{name}</span>
            <span className="text-text-tertiary text-xs font-mono">
              {formatTime(now, timestamp)}
            </span>
          </div>
          {preview && (
            <div className="text-text-secondary font-mono text-xs mt-0.5">
              {preview}
            </div>
          )}
        </div>
      );
    }

    case "text_delta": {
      const text = (data.text as string) || "";
      if (!text.trim()) return null;

      return (
        <div className="border-l border-border px-3 py-1.5 mx-2 my-1">
          <div className="text-sm text-text-primary leading-relaxed whitespace-pre-wrap">
            {text}
          </div>
        </div>
      );
    }

    case "token_update": {
      // Only render if percent changed by >=5 since last
      const percent = data.percent as number | undefined;
      if (typeof percent !== "number") return null;

      const used = (data.used as number) || 0;
      const budget = (data.budget as number) || 0;

      return (
        <div className="text-center my-1">
          <span className="inline-block text-stream-token font-mono text-xs opacity-60">
            ⬡ {Math.round(percent)}% — {formatTokens(used)} / {formatTokens(budget)}
          </span>
        </div>
      );
    }

    case "session_end": {
      const reason = (data.reason as string) || "unknown";
      const isSuccess = reason === "completed";
      const isFailed = reason === "error" || reason === "failed" || reason.includes('fail');

      let bgClass = '';
      let textClass = '';
      let icon = '';

      if (isSuccess) {
        bgClass = 'bg-status-completed/10 border-status-completed/20';
        textClass = 'text-status-completed';
        icon = '✓';
      } else if (isFailed) {
        bgClass = 'bg-status-failed/10 border-status-failed/20';
        textClass = 'text-status-failed';
        icon = '✗';
      } else {
        bgClass = 'bg-status-running/10 border-status-running/20';
        textClass = 'text-status-running';
        icon = '⏹';
      }

      return (
        <div className={`mx-2 my-2 px-4 py-3 rounded border ${bgClass}`}>
          <span className={`text-sm font-medium ${textClass}`}>
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
        <div className="px-4 py-1 mx-2">
          <span className="text-text-tertiary text-xs">
            → {mode} · {complexity} · {reason}
          </span>
        </div>
      );
    }

    case "phase_start": {
      const phase = ((data.phase as string) || "");
      const attempt = data.attempt as number | undefined;

      return (
        <div className="bg-accent/10 border-y border-accent/20 px-4 py-2 mt-3">
          <div className="flex items-center justify-between">
            <span className="text-accent font-bold text-xs uppercase tracking-wider">
              {phase}
            </span>
            {attempt && attempt > 1 && (
              <span className="text-accent/70 text-xs">
                ×{attempt}
              </span>
            )}
          </div>
        </div>
      );
    }

    case "phase_end": {
      const phase = ((data.phase as string) || "").toUpperCase();
      const success = data.success !== false;
      const durationMs = data.durationMs as number | undefined;
      const duration = durationMs !== undefined ? ` (${(durationMs / 1000).toFixed(1)}s)` : "";

      return (
        <div className="px-4 py-1 mx-2 mb-2">
          <span className={`text-xs font-medium ${success ? "text-status-completed" : "text-status-failed"}`}>
            {success ? "✓" : "✗"} {phase}{success ? ` completed${duration}` : " failed"}
          </span>
        </div>
      );
    }

    default:
      return null;
  }
};

export { StreamEventComponent };
