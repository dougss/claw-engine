import { useState, useEffect, useRef } from "react";
import { fetchTaskWithTelemetry, type TelemetryEntry } from "../lib/api";

export interface StreamEvent {
  id: string;
  type: string;
  timestamp: number;
  data: Record<string, unknown>;
}

interface UseStreamResult {
  events: StreamEvent[];
  isLive: boolean;
}

function telemetryToEvents(telemetry: TelemetryEntry[]): StreamEvent[] {
  return telemetry.map((entry, i) => ({
    id: entry.id || `hist-${i}`,
    type: entry.eventType || "unknown",
    timestamp: new Date(entry.createdAt).getTime(),
    data: (entry.data as Record<string, unknown>) || {},
  }));
}

const SSE_EVENT_TYPES = [
  "session_start",
  "session_end",
  "session_resume",
  "text_delta",
  "tool_use",
  "tool_result",
  "token_update",
  "checkpoint",
  "compaction",
  "api_retry",
  "model_fallback",
  "permission_denied",
  "validation_result",
  "phase_start",
  "phase_end",
  "routing_decision",
  "error",
  "heartbeat",
] as const;

export const useStream = (
  taskId: string | null,
  taskStatus: string,
): UseStreamResult => {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [isLive, setIsLive] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    // Cleanup previous
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    setEvents([]);
    setIsLive(false);

    if (!taskId) return;

    // Always load historical telemetry first
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

    // If running, also connect SSE for new events
    if (taskStatus === "running") {
      try {
        const es = new EventSource(`/api/v1/tasks/${taskId}/stream`);
        esRef.current = es;
        setIsLive(true);

        const handleEvent = (ev: MessageEvent) => {
          try {
            const data = JSON.parse(ev.data) as Record<string, unknown>;
            const streamEvent: StreamEvent = {
              id: String(data.id ?? Date.now()),
              type: ev.type,
              timestamp:
                typeof data.timestamp === "number"
                  ? data.timestamp
                  : Date.now(),
              data: (data.data as Record<string, unknown>) ?? data,
            };
            setEvents((prev) => [...prev, streamEvent]);
          } catch {
            // ignore malformed
          }
        };

        for (const type of SSE_EVENT_TYPES) {
          es.addEventListener(type, handleEvent as EventListener);
        }

        es.onerror = () => {
          setIsLive(false);
          es.close();
          esRef.current = null;
        };
      } catch {
        setIsLive(false);
      }
    }

    return () => {
      cancelled = true;
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, [taskId, taskStatus]);

  return { events, isLive };
};
