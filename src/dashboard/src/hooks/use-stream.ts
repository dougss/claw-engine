import { useState, useEffect, useRef } from "react";
import { fetchTaskWithTelemetry, type TelemetryEntry } from "../lib/api";
import { useSseSubscription } from "../lib/sse-context";

export interface StreamEvent {
  id: string;
  type: string;
  timestamp: number;
  data: Record<string, unknown>;
}

function telemetryToEvents(telemetry: TelemetryEntry[]): StreamEvent[] {
  return telemetry.map((entry, i) => ({
    id: entry.id || `hist-${i}`,
    type: entry.eventType || "unknown",
    timestamp: new Date(entry.createdAt).getTime(),
    data: (entry.data as Record<string, unknown>) || {},
  }));
}

export const useStream = (
  taskId: string | null,
  taskStatus: string,
): { events: StreamEvent[]; isLive: boolean } => {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [isLive, setIsLive] = useState(false);
  const taskIdRef = useRef(taskId);

  useEffect(() => {
    taskIdRef.current = taskId;
  }, [taskId]);

  // Load historical telemetry when task changes
  useEffect(() => {
    setEvents([]);
    setIsLive(false);

    if (!taskId) return;

    let cancelled = false;
    const loadHistory = async () => {
      try {
        const detail = await fetchTaskWithTelemetry(taskId);
        if (cancelled) return;
        const telemetry = detail?.telemetry ?? [];
        if (telemetry.length > 0) {
          setEvents(telemetryToEvents(telemetry));
        }
      } catch {
        // best-effort
      }
    };

    loadHistory();

    if (taskStatus === "running") {
      setIsLive(true);
    }

    return () => {
      cancelled = true;
    };
  }, [taskId, taskStatus]);

  // Listen to global SSE for live events matching this task
  useSseSubscription((event) => {
    if (!taskIdRef.current) return;
    if (!isLive && taskStatus !== "running") return;

    const data = event.data as Record<string, unknown> | undefined;
    if (!data) return;

    // CLI publishes events with taskId in the data payload
    if (data.taskId !== taskIdRef.current) return;

    const streamEvent: StreamEvent = {
      id: String(data.id ?? Date.now()),
      type: event.type,
      timestamp:
        typeof data.timestamp === "number" ? data.timestamp : Date.now(),
      data,
    };

    setEvents((prev) => [...prev, streamEvent]);
  });

  return { events, isLive };
};
