import { NavLink, Outlet } from "react-router-dom";

const NAV = [
  { to: "/dag", label: "DAG" },
  { to: "/sessions", label: "Sessions" },
  { to: "/metrics", label: "Metrics" },
  { to: "/logs", label: "Logs" },
];

export function Layout() {
  return (
    <div className="flex h-screen bg-gray-950 text-white">
      {/* Sidebar */}
      <div className="w-48 bg-gray-900 border-r border-gray-800 flex flex-col">
        <div className="p-4 border-b border-gray-800">
          <h1 className="text-lg font-bold text-white">⚙ Claw Engine</h1>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                `block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-blue-600 text-white"
                    : "text-gray-400 hover:bg-gray-800 hover:text-white"
                }`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-gray-800 text-xs text-gray-500">
          Claw Engine v0.1.0
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}
