import { NavLink, Outlet } from "react-router-dom";

// ── Icons ─────────────────────────────────────────────────────────────────────

function IconDag() {
  return (
    <svg
      width="16"
      height="16"
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
      width="16"
      height="16"
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
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  );
}

function IconLogs() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="13" y2="17" />
    </svg>
  );
}

function IconEngine() {
  return (
    <svg
      width="16"
      height="16"
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

// ── Nav config ────────────────────────────────────────────────────────────────

const NAV = [
  { to: "/dag", label: "DAG", Icon: IconDag },
  { to: "/sessions", label: "Sessions", Icon: IconSessions },
  { to: "/metrics", label: "Metrics", Icon: IconMetrics },
  { to: "/logs", label: "Logs", Icon: IconLogs },
];

// ── Layout ────────────────────────────────────────────────────────────────────

export function Layout() {
  return (
    <div className="flex h-screen bg-bg text-text-primary overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 flex flex-col bg-surface border-r border-border-2">
        {/* Brand */}
        <div className="px-4 py-4 border-b border-border-2">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-accent-glow border border-accent/20 flex items-center justify-center text-accent shrink-0">
              <IconEngine />
            </div>
            <div>
              <p className="text-sm font-semibold text-text-primary leading-none tracking-tight">
                Claw Engine
              </p>
              <p className="font-mono text-[10px] text-text-dim mt-0.5 leading-none">
                model-agnostic
              </p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav
          className="flex-1 px-2.5 py-3 space-y-0.5"
          aria-label="Main navigation"
        >
          {NAV.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `relative flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-150 cursor-pointer ${
                  isActive
                    ? "bg-accent-glow text-accent"
                    : "text-text-muted hover:bg-surface-2 hover:text-text-primary"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-accent rounded-r-full" />
                  )}
                  <Icon />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-border-2 flex items-center justify-between">
          <span className="font-mono text-[10px] text-text-dim">v0.1.0</span>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-accent status-pulse" />
            <span className="font-mono text-[10px] text-text-dim">live</span>
          </span>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto min-w-0">
        <Outlet />
      </main>
    </div>
  );
}
