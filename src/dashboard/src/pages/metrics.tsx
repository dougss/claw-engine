import { useState, useEffect } from "react";
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { fetchMetrics, type Metrics } from "../lib/api";
import { PageHeader, LoadingState } from "../components/ui";

// ── Icons ─────────────────────────────────────────────────────────────────────

function IconTasks() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="9 11 12 14 22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

function IconActivity() {
  return (
    <svg
      width="14"
      height="14"
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

function IconTokens() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </svg>
  );
}

function IconCost() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_BARS = [
  {
    key: "completed",
    label: "Completed",
    fill: "#39ff8c",
    glow: "rgba(57,255,140,0.2)",
  },
  {
    key: "running",
    label: "Running",
    fill: "#00d4ff",
    glow: "rgba(0,212,255,0.2)",
  },
  {
    key: "pending",
    label: "Pending",
    fill: "#f59e0b",
    glow: "rgba(245,158,11,0.2)",
  },
  {
    key: "failed",
    label: "Failed",
    fill: "#ff4d6d",
    glow: "rgba(255,77,109,0.2)",
  },
];

// ── Stat card ─────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  accentColor: string;
  glowColor: string;
  sub?: string;
}

function StatCard({
  label,
  value,
  icon,
  accentColor,
  glowColor,
  sub,
}: StatCardProps) {
  return (
    <div
      className="rounded-xl border border-border-2 p-5 space-y-4 hover:border-border-4 transition-all duration-200 group inset-border animate-fade-in"
      style={{
        background: "linear-gradient(135deg, #0a1628, #0f1f35)",
      }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium text-text-muted tracking-widest uppercase">
          {label}
        </span>
        <span
          className="p-2 rounded-lg border"
          style={{
            color: accentColor,
            background: `${glowColor}`,
            borderColor: `${accentColor}25`,
          }}
        >
          {icon}
        </span>
      </div>
      <div>
        <div
          className="font-heading text-2xl font-semibold tracking-tight"
          style={{ color: accentColor }}
        >
          {value}
        </div>
        {sub && (
          <p className="text-[10px] font-mono text-text-dim mt-1">{sub}</p>
        )}
      </div>
    </div>
  );
}

// ── Custom tooltip ────────────────────────────────────────────────────────────

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value: number; fill: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-lg border border-border-3 px-3 py-2"
      style={{ background: "#0f1f35", fontFamily: "JetBrains Mono, monospace" }}
    >
      <p className="text-[10px] text-text-muted mb-1 uppercase tracking-widest">
        {label}
      </p>
      <p className="text-sm font-semibold" style={{ color: payload[0].fill }}>
        {payload[0].value}
      </p>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function MetricsPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  useEffect(() => {
    fetchMetrics().then(setMetrics).catch(console.error);
    const interval = setInterval(() => {
      fetchMetrics().then(setMetrics).catch(console.error);
    }, 10_000);
    return () => clearInterval(interval);
  }, []);

  if (!metrics) return <LoadingState message="Loading metrics..." />;

  const statusData = STATUS_BARS.map(({ key, label, fill }) => ({
    name: label,
    value: metrics.tasks[key as keyof typeof metrics.tasks] as number,
    fill,
  }));

  const tokensK = (metrics.tasks.totalTokens / 1000).toFixed(1);

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <PageHeader
        title="Metrics"
        description="System performance & cost overview"
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Stat cards */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            label="Total Tasks"
            value={metrics.tasks.total}
            icon={<IconTasks />}
            accentColor="#39ff8c"
            glowColor="rgba(57,255,140,0.08)"
            sub="all time"
          />
          <StatCard
            label="Active Work Items"
            value={metrics.workItems.active}
            icon={<IconActivity />}
            accentColor="#00d4ff"
            glowColor="rgba(0,212,255,0.08)"
            sub="in progress"
          />
          <StatCard
            label="Total Tokens"
            value={`${tokensK}k`}
            icon={<IconTokens />}
            accentColor="#a78bfa"
            glowColor="rgba(167,139,250,0.08)"
            sub="consumed"
          />
          <StatCard
            label="Total Cost"
            value={`$${Number(metrics.tasks.totalCost).toFixed(4)}`}
            icon={<IconCost />}
            accentColor="#fb923c"
            glowColor="rgba(251,146,60,0.08)"
            sub="USD spent"
          />
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Status distribution */}
          <div
            className="rounded-xl border border-border-2 p-5 inset-border"
            style={{ background: "linear-gradient(135deg, #0a1628, #0f1f35)" }}
          >
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="font-heading text-sm font-semibold text-text-primary">
                  Task Distribution
                </h2>
                <p className="text-[10px] text-text-muted mt-0.5">
                  Status breakdown
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap justify-end">
                {STATUS_BARS.map(({ label, fill }) => (
                  <span
                    key={label}
                    className="flex items-center gap-1 text-[10px] font-mono text-text-muted"
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-sm"
                      style={{ backgroundColor: fill }}
                    />
                    {label}
                  </span>
                ))}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={statusData} barSize={28} barGap={8}>
                <CartesianGrid
                  strokeDasharray="2 4"
                  stroke="rgba(46,74,106,0.4)"
                  vertical={false}
                />
                <XAxis
                  dataKey="name"
                  tick={{
                    fill: "#5c7a9e",
                    fontSize: 10,
                    fontFamily: "JetBrains Mono",
                  }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{
                    fill: "#5c7a9e",
                    fontSize: 10,
                    fontFamily: "JetBrains Mono",
                  }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                  width={24}
                />
                <Tooltip
                  content={<CustomTooltip />}
                  cursor={{ fill: "rgba(255,255,255,0.03)" }}
                />
                <Bar dataKey="value" radius={[5, 5, 0, 0]}>
                  {statusData.map((entry) => (
                    <Cell key={entry.name} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Completion rate */}
          <div
            className="rounded-xl border border-border-2 p-5 inset-border"
            style={{ background: "linear-gradient(135deg, #0a1628, #0f1f35)" }}
          >
            <div className="mb-5">
              <h2 className="font-heading text-sm font-semibold text-text-primary">
                Completion Rate
              </h2>
              <p className="text-[10px] text-text-muted mt-0.5">
                Completed vs total tasks
              </p>
            </div>
            <div className="flex items-end gap-6 mb-4">
              <div>
                <div
                  className="font-heading text-3xl font-semibold"
                  style={{ color: "#39ff8c" }}
                >
                  {metrics.tasks.total > 0
                    ? Math.round(
                        (metrics.tasks.completed / metrics.tasks.total) * 100,
                      )
                    : 0}
                  %
                </div>
                <p className="text-[10px] font-mono text-text-dim mt-1">
                  success rate
                </p>
              </div>
              <div className="ml-auto text-right">
                <div className="font-mono text-sm text-text-secondary">
                  {metrics.tasks.completed}
                </div>
                <p className="text-[10px] font-mono text-text-dim">completed</p>
              </div>
              <div className="text-right">
                <div className="font-mono text-sm" style={{ color: "#ff4d6d" }}>
                  {metrics.tasks.failed ?? 0}
                </div>
                <p className="text-[10px] font-mono text-text-dim">failed</p>
              </div>
            </div>
            {/* Progress bar */}
            <div
              className="h-2 rounded-full overflow-hidden"
              style={{ background: "rgba(46,74,106,0.4)" }}
            >
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${metrics.tasks.total > 0 ? Math.round((metrics.tasks.completed / metrics.tasks.total) * 100) : 0}%`,
                  background: "linear-gradient(90deg, #39ff8c, #00d4ff)",
                  boxShadow: "0 0 8px rgba(57,255,140,0.5)",
                }}
              />
            </div>
            {/* Work items breakdown */}
            <div className="mt-4 pt-4 border-t border-border flex items-center justify-between">
              <span className="text-[10px] font-mono text-text-muted">
                Work items
              </span>
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1.5 text-[10px] font-mono text-text-muted">
                  <span className="w-1.5 h-1.5 rounded-full bg-status-running" />
                  {metrics.workItems.active} active
                </span>
                <span className="flex items-center gap-1.5 text-[10px] font-mono text-text-muted">
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: "#5c7a9e" }}
                  />
                  {metrics.workItems.total} total
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
