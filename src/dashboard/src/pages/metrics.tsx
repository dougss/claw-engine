import { useState, useEffect } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { fetchMetrics, type Metrics } from "../lib/api";

export function MetricsPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  useEffect(() => {
    fetchMetrics().then(setMetrics).catch(console.error);
    const interval = setInterval(() => {
      fetchMetrics().then(setMetrics).catch(console.error);
    }, 10_000);
    return () => clearInterval(interval);
  }, []);

  if (!metrics)
    return <div className="p-4 text-gray-400">Loading metrics...</div>;

  const statusData = [
    { name: "Completed", value: metrics.tasks.completed, fill: "#22c55e" },
    { name: "Running", value: metrics.tasks.running, fill: "#3b82f6" },
    { name: "Pending", value: metrics.tasks.pending, fill: "#f59e0b" },
    { name: "Failed", value: metrics.tasks.failed, fill: "#ef4444" },
  ];

  return (
    <div className="p-4 space-y-6">
      <h2 className="text-xl font-semibold text-white">Metrics</h2>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Total Tasks" value={metrics.tasks.total} />
        <StatCard label="Active Work Items" value={metrics.workItems.active} />
        <StatCard
          label="Total Tokens"
          value={metrics.tasks.totalTokens.toLocaleString()}
        />
        <StatCard
          label="Total Cost"
          value={`$${Number(metrics.tasks.totalCost).toFixed(4)}`}
        />
      </div>

      <div className="bg-gray-800 rounded-lg p-4">
        <h3 className="text-sm text-gray-400 mb-4">Task Status Distribution</h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={statusData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey="name" tick={{ fill: "#9ca3af" }} />
            <YAxis tick={{ fill: "#9ca3af" }} />
            <Tooltip
              contentStyle={{
                backgroundColor: "#1f2937",
                border: "none",
                color: "#fff",
              }}
            />
            <Bar dataKey="value" fill="#3b82f6" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-gray-800 rounded-lg p-3">
      <div className="text-xs text-gray-400">{label}</div>
      <div className="text-2xl font-bold text-white mt-1">{value}</div>
    </div>
  );
}
