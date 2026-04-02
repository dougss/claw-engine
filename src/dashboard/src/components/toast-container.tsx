import { useState, useEffect, memo } from "react";
import { subscribe, type Toast } from "../lib/toast";

const TYPE_STYLES: Record<
  string,
  { border: string; icon: string; bg: string }
> = {
  success: {
    border: "rgba(57,255,140,0.3)",
    icon: "#39ff8c",
    bg: "rgba(57,255,140,0.06)",
  },
  error: {
    border: "rgba(255,77,109,0.3)",
    icon: "#ff4d6d",
    bg: "rgba(255,77,109,0.06)",
  },
  info: {
    border: "rgba(0,212,255,0.3)",
    icon: "#00d4ff",
    bg: "rgba(0,212,255,0.06)",
  },
};

const ToastItem = memo(function ToastItem({ toast }: { toast: Toast }) {
  const style = TYPE_STYLES[toast.type] ?? TYPE_STYLES.info;
  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-xl border backdrop-blur-md ${toast.exiting ? "animate-toast-out" : "animate-toast-in"}`}
      style={{
        background: style.bg,
        borderColor: style.border,
        boxShadow: `0 4px 24px rgba(0,0,0,0.4), 0 0 0 1px ${style.border}`,
      }}
      role="status"
      aria-live="polite"
    >
      <span className="shrink-0" aria-hidden="true">
        {toast.type === "success" && (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke={style.icon}
            strokeWidth="2"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
        {toast.type === "error" && (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke={style.icon}
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        )}
        {toast.type === "info" && (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke={style.icon}
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        )}
      </span>
      <span className="text-xs font-medium text-text-primary">
        {toast.message}
      </span>
    </div>
  );
});

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => subscribe(setToasts), []);

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm"
      aria-label="Notifications"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}
