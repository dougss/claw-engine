import type { PipelinePhase } from "./api";

export const PHASE_ORDER: PipelinePhase[] = [
  "plan",
  "execute",
  "validate",
  "review",
  "pr",
];

export const PHASE_LABELS: Record<PipelinePhase, string> = {
  plan: "PLAN",
  execute: "EXECUTE",
  validate: "VALIDATE",
  review: "REVIEW",
  pr: "PR",
};

export const PHASE_COLORS: Record<
  PipelinePhase,
  { accent: string; bg: string; border: string; glow: string }
> = {
  plan: {
    accent: "#a78bfa",
    bg: "rgba(167,139,250,0.08)",
    border: "rgba(167,139,250,0.3)",
    glow: "rgba(167,139,250,0.15)",
  },
  execute: {
    accent: "#00d4ff",
    bg: "rgba(0,212,255,0.08)",
    border: "rgba(0,212,255,0.3)",
    glow: "rgba(0,212,255,0.15)",
  },
  validate: {
    accent: "#818cf8",
    bg: "rgba(129,140,248,0.08)",
    border: "rgba(129,140,248,0.3)",
    glow: "rgba(129,140,248,0.15)",
  },
  review: {
    accent: "#fb923c",
    bg: "rgba(251,146,60,0.08)",
    border: "rgba(251,146,60,0.3)",
    glow: "rgba(251,146,60,0.15)",
  },
  pr: {
    accent: "#39ff8c",
    bg: "rgba(57,255,140,0.08)",
    border: "rgba(57,255,140,0.3)",
    glow: "rgba(57,255,140,0.15)",
  },
};

export type PhaseStatus =
  | "completed"
  | "running"
  | "failed"
  | "pending"
  | "skipped";

export function getPhaseStatus(
  phase: PipelinePhase,
  phases: PhaseEvent[],
  currentPhase: PipelinePhase | null,
): PhaseStatus {
  const started = phases.find(
    (p) => p.phase === phase && p.eventType === "phase_start",
  );
  const ended = phases.find(
    (p) => p.phase === phase && p.eventType === "phase_end",
  );

  if (ended) return ended.success ? "completed" : "failed";
  if (started && phase === currentPhase) return "running";
  if (started) return "running";
  return "pending";
}

export interface PhaseEvent {
  phase: PipelinePhase;
  eventType: "phase_start" | "phase_end";
  attempt: number;
  success?: boolean;
  durationMs?: number;
  createdAt: string;
}

export function extractPhaseEvents(telemetry: TelemetryEntry[]): PhaseEvent[] {
  return telemetry
    .filter((t) => t.eventType === "phase_start" || t.eventType === "phase_end")
    .map((t) => {
      const data = t.data as Record<string, unknown>;
      return {
        phase: data.phase as PipelinePhase,
        eventType: t.eventType as "phase_start" | "phase_end",
        attempt: (data.attempt as number) ?? 1,
        success: data.success as boolean | undefined,
        durationMs: data.durationMs as number | undefined,
        createdAt: t.createdAt,
      };
    });
}

export interface TelemetryEntry {
  id: string;
  taskId: string;
  eventType: string;
  data: unknown;
  createdAt: string;
}

export function getCurrentPhase(phases: PhaseEvent[]): PipelinePhase | null {
  const starts = phases.filter((p) => p.eventType === "phase_start");
  const ends = phases.filter((p) => p.eventType === "phase_end");
  const endedPhases = new Set(ends.map((e) => e.phase));
  const active = starts.find((s) => !endedPhases.has(s.phase));
  return active?.phase ?? null;
}

export function isPipelineRun(telemetry: TelemetryEntry[]): boolean {
  return telemetry.some(
    (t) => t.eventType === "phase_start" || t.eventType === "phase_end",
  );
}

export function getRetryCount(phases: PhaseEvent[]): number {
  const executeStarts = phases.filter(
    (p) => p.phase === "execute" && p.eventType === "phase_start",
  );
  return Math.max(0, executeStarts.length - 1);
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

export function getTotalDuration(phases: PhaseEvent[]): number {
  return phases
    .filter((p) => p.eventType === "phase_end" && p.durationMs)
    .reduce((sum, p) => sum + (p.durationMs ?? 0), 0);
}
