import { useState, useEffect, useCallback } from "react";
import { createSseClient } from "../lib/sse";
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
} from "recharts";
import {
  fetchMetrics,
  fetchCostHistory,
  fetchExecutions,
  fetchTaskWithTelemetry,
  type Metrics,
  type CostDataPoint,
} from "../lib/api";
import {
  extractPhaseEvents,
  isPipelineRun,
  PHASE_ORDER,
  PHASE_LABELS,
  PHASE_COLORS,
} from "../lib/pipeline";
import { PageHeader, LoadingState } from "../components/ui";

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

function IconAvgTokens() {
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
    </svg>
  );
}

function IconClock() {
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
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

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
      style={{ background: "linear-gradient(135deg, #0a1628, #0f1f35)" }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium text-text-muted tracking-widest uppercase">
          {label}
        </span>
        <span
          className="p-2 rounded-lg border"
          style={{
            color: accentColor,
            background: glowColor,
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

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value: number; fill?: string; color?: string; name?: string }[];
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
      {payload.map((p, i) => (
        <p
          key={i}
          className="text-sm font-semibold"
          style={{ color: p.fill ?? p.color ?? "#00d4ff" }}
        >
          {p.name ? `${p.name}: ` : ""}
          {typeof p.value === "number" && p.value < 1
            ? `$${p.value.toFixed(4)}`
            : p.value}
        </p>
      ))}
    </div>
  );
}

function CostLineChart({ data }: { data: CostDataPoint[] }) {
  const cumulative = data.reduce<
    { label: string; cost: number; cumulative: number }[]
  >((acc, point) => {
    const prev = acc.length > 0 ? acc[acc.length - 1].cumulative : 0;
    acc.push({
      label: point.label,
      cost: point.cost,
      cumulative: prev + point.cost,
    });
    return acc;
  }, []);

  return (
    <div
      className="rounded-xl border border-border-2 p-5 inset-border"
      style={{ background: "linear-gradient(135deg, #0a1628, #0f1f35)" }}
    >
      <div className="mb-5">
        <h2 className="font-heading text-sm font-semibold text-text-primary">
          Cumulative Cost
        </h2>
        <p className="text-[10px] text-text-muted mt-0.5">
          Last {data.length} runs
        </p>
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={cumulative}>
          <CartesianGrid
            strokeDasharray="2 4"
            stroke="rgba(46,74,106,0.4)"
            vertical={false}
          />
          <XAxis
            dataKey="label"
            tick={{
              fill: "#5c7a9e",
              fontSize: 9,
              fontFamily: "JetBrains Mono",
            }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{
              fill: "#5c7a9e",
              fontSize: 10,
              fontFamily: "JetBrains Mono",
            }}
            axisLine={false}
            tickLine={false}
            width={40}
            tickFormatter={(v: number) => `$${v.toFixed(2)}`}
          />
          <Tooltip content={<CustomTooltip />} />
          <Line
            type="monotone"
            dataKey="cumulative"
            stroke="#39ff8c"
            strokeWidth={2}
            dot={false}
            activeDot={{
              r: 4,
              fill: "#39ff8c",
              stroke: "#0a1628",
              strokeWidth: 2,
            }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

const PROVIDER_COLORS: Record<string, string> = {
  anthropic: "#a78bfa",
  opencode: "#00d4ff",
  claude: "#a78bfa",
  openai: "#39ff8c",
  unknown: "#5c7a9e",
};

function ProviderDonutChart({
  executions,
}: {
  executions: { model: string; cost: number }[];
}) {
  const byProvider = executions.reduce<Record<string, number>>((acc, e) => {
    const provider = e.model?.split("/")[0] ?? "unknown";
    acc[provider] = (acc[provider] ?? 0) + e.cost;
    return acc;
  }, {});

  const data = Object.entries(byProvider).map(([name, value]) => ({
    name,
    value: Number(value.toFixed(4)),
    fill: PROVIDER_COLORS[name] ?? "#5c7a9e",
  }));

  if (data.length === 0) return null;

  return (
    <div
      className="rounded-xl border border-border-2 p-5 inset-border"
      style={{ background: "linear-gradient(135deg, #0a1628, #0f1f35)" }}
    >
      <div className="mb-5">
        <h2 className="font-heading text-sm font-semibold text-text-primary">
          Cost by Provider
        </h2>
        <p className="text-[10px] text-text-muted mt-0.5">Breakdown</p>
      </div>
      <div className="flex items-center gap-4">
        <ResponsiveContainer width={140} height={140}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={35}
              outerRadius={60}
              dataKey="value"
              stroke="none"
            >
              {data.map((entry) => (
                <Cell key={entry.name} fill={entry.fill} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="space-y-2 flex-1">
          {data.map((d) => (
            <div key={d.name} className="flex items-center gap-2">
              <span
                className="w-2 h-2 rounded-sm shrink-0"
                style={{ backgroundColor: d.fill }}
              />
              <span className="text-[10px] font-mono text-text-secondary flex-1">
                {d.name}
              </span>
              <span
                className="text-[10px] font-mono font-semibold"
                style={{ color: d.fill }}
              >
                ${d.value.toFixed(4)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

interface PhaseSuccessRate {
  phase: string;
  passFirst: number;
  total: number;
  rate: number;
}

function PhaseSuccessRateChart({ rates }: { rates: PhaseSuccessRate[] }) {
  if (rates.length === 0) return null;

  return (
    <div
      className="rounded-xl border border-border-2 p-5 inset-border"
      style={{ background: "linear-gradient(135deg, #0a1628, #0f1f35)" }}
    >
      <div className="mb-5">
        <h2 className="font-heading text-sm font-semibold text-text-primary">
          Phase Success Rate
        </h2>
        <p className="text-[10px] text-text-muted mt-0.5">
          First-attempt pass rate
        </p>
      </div>
      <div className="space-y-3">
        {rates.map((r) => {
          const colors = PHASE_COLORS[r.phase as keyof typeof PHASE_COLORS];
          return (
            <div key={r.phase}>
              <div className="flex items-center justify-between mb-1">
                <span
                  className="font-mono text-[10px] font-medium uppercase tracking-wider"
                  style={{ color: colors?.accent ?? "#5c7a9e" }}
                >
                  {PHASE_LABELS[r.phase as keyof typeof PHASE_LABELS] ??
                    r.phase}
                </span>
                <span className="font-mono text-[10px] text-text-muted">
                  {r.passFirst}/{r.total} ({r.rate}%)
                </span>
              </div>
              <div
                className="h-1.5 rounded-full overflow-hidden"
                style={{ background: "rgba(46,74,106,0.4)" }}
              >
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${r.rate}%`,
                    background: colors?.accent ?? "#5c7a9e",
                    boxShadow: `0 0 6px ${colors?.glow ?? "transparent"}`,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function MetricsPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [metricsError, setMetricsError] = useState(false);
  const [costHistory, setCostHistory] = useState<CostDataPoint[]>([]);
  const [providerBreakdown, setProviderBreakdown] = useState<
    { model: string; cost: number }[]
  >([]);
  const [phaseRates, setPhaseRates] = useState<PhaseSuccessRate[]>([]);
  const [avgTokensPerRun, setAvgTokensPerRun] = useState(0);
  const [avgDurationByPhase, setAvgDurationByPhase] = useState<
    Record<string, number>
  >({});

  const reloadMetrics = useCallback(() => {
    setMetricsError(false);
    fetchMetrics()
      .then(setMetrics)
      .catch(() => setMetricsError(true));
  }, []);

  useEffect(() => {
    reloadMetrics();
    fetchCostHistory(20).then(setCostHistory).catch(console.error);

    fetchExecutions(50)
      .then(async (execs) => {
        const providers: { model: string; cost: number }[] = [];
        const phaseAttempts: Record<
          string,
          { firstPass: number; total: number }
        > = {};
        const phaseDurations: Record<string, number[]> = {};
        let totalTokens = 0;
        let runCount = 0;

        for (const exec of execs) {
          totalTokens += exec.totalTokensUsed ?? 0;
          runCount++;

          const firstTask = exec.tasks[0];
          if (!firstTask) continue;

          providers.push({
            model: firstTask.model ?? "unknown",
            cost: Number(exec.totalCostUsd ?? 0),
          });

          try {
            const tw = await fetchTaskWithTelemetry(firstTask.id);
            if (!isPipelineRun(tw.telemetry)) continue;
            const phases = extractPhaseEvents(tw.telemetry);

            for (const phase of PHASE_ORDER) {
              const starts = phases.filter(
                (p) => p.phase === phase && p.eventType === "phase_start",
              );
              const ends = phases.filter(
                (p) => p.phase === phase && p.eventType === "phase_end",
              );
              if (starts.length === 0) continue;

              if (!phaseAttempts[phase])
                phaseAttempts[phase] = { firstPass: 0, total: 0 };
              phaseAttempts[phase].total++;

              const firstEnd = ends[0];
              if (firstEnd?.success) phaseAttempts[phase].firstPass++;

              for (const end of ends) {
                if (end.durationMs) {
                  if (!phaseDurations[phase]) phaseDurations[phase] = [];
                  phaseDurations[phase].push(end.durationMs);
                }
              }
            }
          } catch {
            // skip
          }
        }

        setProviderBreakdown(providers);
        setAvgTokensPerRun(
          runCount > 0 ? Math.round(totalTokens / runCount) : 0,
        );

        const rates: PhaseSuccessRate[] = PHASE_ORDER.filter(
          (p) => phaseAttempts[p],
        ).map((p) => ({
          phase: p,
          passFirst: phaseAttempts[p].firstPass,
          total: phaseAttempts[p].total,
          rate: Math.round(
            (phaseAttempts[p].firstPass / phaseAttempts[p].total) * 100,
          ),
        }));
        setPhaseRates(rates);

        const avgDur: Record<string, number> = {};
        for (const [phase, durations] of Object.entries(phaseDurations)) {
          avgDur[phase] = Math.round(
            durations.reduce((a, b) => a + b, 0) / durations.length,
          );
        }
        setAvgDurationByPhase(avgDur);
      })
      .catch(console.error);

    // SSE-driven refresh: re-fetch on session completions and token updates
    const cleanup = createSseClient((event) => {
      if (event.type === "session_end" || event.type === "token_update") {
        reloadMetrics();
      }
    });
    return cleanup;
  }, [reloadMetrics]);

  if (metricsError) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#ff4d6d"
          strokeWidth="1.5"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <p className="text-sm text-text-muted">Failed to load metrics</p>
        <button
          onClick={reloadMetrics}
          className="font-mono text-xs text-accent hover:text-accent/80 transition-colors cursor-pointer"
        >
          retry
        </button>
      </div>
    );
  }

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
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
          <StatCard
            label="Total Tasks"
            value={metrics.tasks.total}
            icon={<IconTasks />}
            accentColor="#39ff8c"
            glowColor="rgba(57,255,140,0.08)"
            sub="all time"
          />
          <StatCard
            label="Active"
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
          <StatCard
            label="Avg Tokens/Run"
            value={
              avgTokensPerRun > 1000
                ? `${(avgTokensPerRun / 1000).toFixed(1)}k`
                : String(avgTokensPerRun)
            }
            icon={<IconAvgTokens />}
            accentColor="#818cf8"
            glowColor="rgba(129,140,248,0.08)"
            sub="per execution"
          />
          <StatCard
            label="Avg Duration"
            value={
              Object.values(avgDurationByPhase).length > 0
                ? `${(Object.values(avgDurationByPhase).reduce((a, b) => a + b, 0) / 1000).toFixed(0)}s`
                : "—"
            }
            icon={<IconClock />}
            accentColor="#fbbf24"
            glowColor="rgba(251,191,36,0.08)"
            sub="per pipeline"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {costHistory.length > 0 && <CostLineChart data={costHistory} />}
          <ProviderDonutChart executions={providerBreakdown} />
          <PhaseSuccessRateChart rates={phaseRates} />
        </div>
      </div>
    </div>
  );
}
