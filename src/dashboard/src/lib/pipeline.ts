import type { PipelinePhase } from "./api";

/** Safely cast unknown to a string-keyed object, returning {} if not an object */
export function asRecord(val: unknown): Record<string, unknown> {
  if (typeof val === "object" && val !== null && !Array.isArray(val)) {
    return val as Record<string, unknown>;
  }
  return {};
}

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
      const data = asRecord(t.data);
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

export interface PhaseOutput {
  textContent: string; // joined text_delta events in this phase
  toolCalls: Array<{ name: string; input: unknown; createdAt: string }>;
  validations: TelemetryEntry[];
}

/**
 * Extract telemetry events that occurred between phase_start and phase_end for a given phase.
 * Uses createdAt timestamps to determine which events belong to which phase.
 */
export function getPhaseOutput(
  phase: PipelinePhase,
  telemetry: TelemetryEntry[],
): PhaseOutput {
  // Find last phase_start and first phase_end for this phase (handles retries)
  const starts = telemetry
    .filter(
      (t) => t.eventType === "phase_start" && asRecord(t.data).phase === phase,
    )
    .sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

  const ends = telemetry
    .filter(
      (t) => t.eventType === "phase_end" && asRecord(t.data).phase === phase,
    )
    .sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

  if (starts.length === 0)
    return { textContent: "", toolCalls: [], validations: [] };

  // Use the last start (most recent attempt) and its corresponding end
  const lastStart = starts[starts.length - 1];
  const startTime = new Date(lastStart.createdAt).getTime();
  const endTime =
    ends.length > 0
      ? new Date(ends[ends.length - 1].createdAt).getTime()
      : Date.now();

  // For retries: find the end of the previous attempt (if any) as a hard lower bound
  const prevEnd =
    ends.length > 1 ? new Date(ends[ends.length - 2].createdAt).getTime() : 0;
  const lowerBound = Math.max(startTime, prevEnd);

  const phaseEvents = telemetry.filter((t) => {
    const ts = new Date(t.createdAt).getTime();
    return ts > lowerBound && ts <= endTime;
  });

  const textContent = phaseEvents
    .filter((t) => t.eventType === "text_delta")
    .map((t) => {
      const d = asRecord(t.data);
      return typeof d.text === "string" ? d.text : "";
    })
    .join("");

  const toolCalls = phaseEvents
    .filter((t) => t.eventType === "tool_use")
    .map((t) => {
      const d = asRecord(t.data);
      return {
        name: typeof d.name === "string" ? d.name : "unknown",
        input: d.input ?? {},
        createdAt: t.createdAt,
      };
    });

  const validations = phaseEvents.filter(
    (t) => t.eventType === "validation_result",
  );

  return { textContent, toolCalls, validations };
}
