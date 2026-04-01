import React, { useState, useEffect } from "react";
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

// ── Stat card icons ───────────────────────────────────────────────────────────

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

// ── Status bar config ─────────────────────────────────────────────────────────

const STATUS_BARS = [
  { key: "completed", label: "Completed", fill: "#22C55E" },
  { key: "running", label: "Running", fill: "#3B82F6" },
  { key: "pending", label: "Pending", fill: "#F59E0B" },
  { key: "failed", label: "Failed", fill: "#EF4444" },
];

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

  if (!metrics) {
    return (
      <div className="p-6 flex items-center gap-2 text-text-muted text-sm">
        <span className="w-4 h-4 rounded-full border-2 border-accent border-t-transparent animate-spin" />
        Loading metrics...
      </div>
    );
  }

  const statusData = STATUS_BARS.map(({ key, label, fill }) => ({
    name: label,
    value: metrics.tasks[key as keyof typeof metrics.tasks] as number,
    fill,
  }));

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-heading text-base font-semibold text-text-primary">
          Metrics
        </h1>
        <p className="text-xs text-text-muted mt-0.5">
          System performance &amp; cost overview
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Total Tasks"
          value={metrics.tasks.total}
          Icon={IconTasks}
          accent="text-status-completed"
        />
        <StatCard
          label="Active Work Items"
          value={metrics.workItems.active}
          Icon={IconActivity}
          accent="text-status-running"
        />
        <StatCard
          label="Total Tokens"
          value={metrics.tasks.totalTokens.toLocaleString()}
          Icon={IconTokens}
          accent="text-status-provisioning"
        />
        <StatCard
          label="Total Cost"
          value={`$${Number(metrics.tasks.totalCost).toFixed(4)}`}
          Icon={IconCost}
          accent="text-accent"
        />
      </div>

      {/* Chart */}
      <div className="bg-surface rounded-xl border border-border-2 p-5">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-heading text-sm font-medium text-text-primary">
            Task Status Distribution
          </h2>
          <div className="flex items-center gap-3">
            {STATUS_BARS.map(({ label, fill }) => (
              <span
                key={label}
                className="flex items-center gap-1.5 text-xs text-text-muted"
              >
                <span
                  className="w-2 h-2 rounded-sm"
                  style={{ backgroundColor: fill }}
                />
                {label}
              </span>
            ))}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={statusData} barSize={32}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#334155"
              vertical={false}
            />
            <XAxis
              dataKey="name"
              tick={{ fill: "#94A3B8", fontSize: 12, fontFamily: "Fira Sans" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: "#94A3B8", fontSize: 12, fontFamily: "Fira Code" }}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
            />
            <Tooltip
              cursor={{ fill: "rgba(255,255,255,0.04)" }}
              contentStyle={{
                backgroundColor: "#1E293B",
                border: "1px solid #334155",
                borderRadius: 8,
                color: "#F8FAFC",
                fontSize: 12,
                fontFamily: "Fira Code",
              }}
            />
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              {statusData.map((entry) => (
                <Cell key={entry.name} fill={entry.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  Icon,
  accent,
}: {
  label: string;
  value: number | string;
  Icon: () => React.ReactElement;
  accent: string;
}) {
  return (
    <div className="bg-surface rounded-xl border border-border-2 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-muted font-medium">{label}</span>
        <span className={accent}>
          <Icon />
        </span>
      </div>
      <div className="font-heading text-2xl font-semibold text-text-primary">
        {value}
      </div>
    </div>
  );
}
