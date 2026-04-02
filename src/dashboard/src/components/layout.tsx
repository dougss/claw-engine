import { useState, useEffect, useCallback } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { ToastContainer } from "./toast-container";
import { useSseSubscription } from "../lib/sse-context";
import { addToast } from "../lib/toast";

function IconPipeline() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="2" y1="12" x2="22" y2="12" />
      <circle cx="6" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="18" cy="12" r="2" />
    </svg>
  );
}

function IconDag() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="5" cy="12" r="2" />
      <circle cx="19" cy="5" r="2" />
      <circle cx="19" cy="19" r="2" />
      <line x1="7" y1="11.5" x2="17" y2="6.5" />
      <line x1="7" y1="12.5" x2="17" y2="17.5" />
    </svg>
  );
}

function IconSessions() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <polyline points="8 21 12 17 16 21" />
    </svg>
  );
}

function IconMetrics() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

function IconLogs() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

function LogoMark() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

const NAV = [
  {
    to: "/pipeline",
    label: "Pipeline",
    Icon: IconPipeline,
    desc: "Phase tracking",
  },
  { to: "/dag", label: "DAG", Icon: IconDag, desc: "Task graph" },
  {
    to: "/sessions",
    label: "Executions",
    Icon: IconSessions,
    desc: "Run history",
  },
  { to: "/metrics", label: "Metrics", Icon: IconMetrics, desc: "Performance" },
  { to: "/logs", label: "Logs", Icon: IconLogs, desc: "Telemetry" },
];

function ActiveRunsBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <div
      className="mx-4 mb-2 flex items-center gap-2 px-3 py-2 rounded-lg border animate-fade-in"
      style={{
        background:
          "linear-gradient(135deg, rgba(0,212,255,0.06), rgba(57,255,140,0.03))",
        borderColor: "rgba(0,212,255,0.15)",
      }}
    >
      <span
        className="w-2 h-2 rounded-full bg-status-running status-pulse"
        style={{ boxShadow: "0 0 8px rgba(0,212,255,0.6)" }}
      />
      <span className="font-mono text-[10px] text-accent font-semibold">
        {count}
      </span>
      <span className="font-mono text-[10px] text-text-muted">
        active run{count > 1 ? "s" : ""}
      </span>
    </div>
  );
}

export function Layout() {
  const [activeRuns, setActiveRuns] = useState(0);

  const updateActiveCount = useCallback(() => {
    fetch("/api/v1/sessions")
      .then((r) => {
        if (!r.ok) throw new Error(`sessions: ${r.status}`);
        return r.json();
      })
      .then((data: { sessions: unknown[] }) =>
        setActiveRuns(data.sessions.length),
      )
      .catch(() => {});
  }, []);

  useSseSubscription((event) => {
    if (event.type === "session_start" || event.type === "session_end") {
      updateActiveCount();
    }
    if (event.type === "session_end") {
      const data = event.data as Record<string, unknown>;
      const reason = data?.reason as string | undefined;
      if (reason === "completed") {
        addToast("Run completed successfully", "success");
      } else if (reason === "error") {
        addToast("Run failed with error", "error");
      }
    }
    if (event.type === "phase_start") {
      const data = event.data as Record<string, unknown>;
      const phase = data?.phase as string;
      if (phase) {
        addToast(`Phase ${phase.toUpperCase()} started`, "info");
      }
    }
  });

  useEffect(() => {
    updateActiveCount();
    const interval = setInterval(updateActiveCount, 15_000);
    return () => clearInterval(interval);
  }, [updateActiveCount]);

  return (
    <div className="flex h-screen bg-bg text-text-primary overflow-hidden">
      <ToastContainer />

      <aside
        className="w-52 shrink-0 flex flex-col border-r border-border-2"
        style={{
          background: "linear-gradient(180deg, #0a1628 0%, #050a0f 100%)",
        }}
      >
        <div className="px-4 py-5 border-b border-border-2">
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 text-accent glow-pulse"
              style={{
                background:
                  "linear-gradient(135deg, rgba(0,212,255,0.12), rgba(57,255,140,0.06))",
                border: "1px solid rgba(0,212,255,0.2)",
              }}
            >
              <LogoMark />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-text-primary leading-none tracking-tight">
                Claw Engine
              </p>
              <p className="font-mono text-[9px] text-text-muted mt-1 leading-none tracking-widest uppercase">
                Agent Factory
              </p>
            </div>
          </div>
        </div>

        <ActiveRunsBadge count={activeRuns} />

        <div className="px-4 pt-3 pb-1.5">
          <p className="text-[9px] font-mono text-text-dim tracking-widest uppercase">
            Navigation
          </p>
        </div>

        <nav
          className="flex-1 px-2.5 pb-3 space-y-0.5"
          aria-label="Main navigation"
        >
          {NAV.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `relative flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium transition-all duration-150 cursor-pointer group ${
                  isActive
                    ? "text-accent"
                    : "text-text-muted hover:text-text-secondary"
                }`
              }
              style={({ isActive }) =>
                isActive
                  ? {
                      background:
                        "linear-gradient(90deg, rgba(0,212,255,0.08), transparent)",
                      border: "1px solid rgba(0,212,255,0.12)",
                    }
                  : {
                      background: "transparent",
                      border: "1px solid transparent",
                    }
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span
                      className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 rounded-r-full"
                      style={{
                        background: "linear-gradient(180deg, #00d4ff, #39ff8c)",
                      }}
                    />
                  )}
                  <Icon />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div
          className="px-4 py-3 border-t border-border-2 flex items-center justify-between"
          style={{ background: "rgba(0,0,0,0.2)" }}
        >
          <span className="font-mono text-[9px] text-text-dim tracking-widest">
            v0.2.0
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="w-1.5 h-1.5 rounded-full bg-neon status-pulse"
              style={{ boxShadow: "0 0 6px rgba(57,255,140,0.6)" }}
            />
            <span className="font-mono text-[9px] text-text-muted tracking-wide">
              LIVE
            </span>
          </span>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto min-w-0 bg-bg">
        <Outlet />
      </main>
    </div>
  );
}
