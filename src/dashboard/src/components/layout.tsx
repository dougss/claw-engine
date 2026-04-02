import { NavLink, Outlet } from "react-router-dom";

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

export function Layout() {
  return (
    <div className="flex h-screen bg-bg text-text-primary overflow-hidden">
      {/* Sidebar */}
      <aside
        className="w-52 shrink-0 flex flex-col border-r border-border-2"
        style={{
          background: "linear-gradient(180deg, #0a1628 0%, #050a0f 100%)",
        }}
      >
        {/* Brand */}
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

        {/* Divider label */}
        <div className="px-4 pt-4 pb-1.5">
          <p className="text-[9px] font-mono text-text-dim tracking-widest uppercase">
            Navigation
          </p>
        </div>

        {/* Navigation */}
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

        {/* Footer */}
        <div
          className="px-4 py-3 border-t border-border-2 flex items-center justify-between"
          style={{ background: "rgba(0,0,0,0.2)" }}
        >
          <span className="font-mono text-[9px] text-text-dim tracking-widest">
            v0.1.0
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

      {/* Main */}
      <main className="flex-1 overflow-y-auto min-w-0 bg-bg">
        <Outlet />
      </main>
    </div>
  );
}
