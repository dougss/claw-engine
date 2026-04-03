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

export const useStream = (
  taskId: string | null,
  taskStatus: string,
): UseStreamResult => {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [isLive, setIsLive] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Clear events and close SSE connection when taskId changes
  useEffect(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    setEvents([]);
    setIsLive(false);

    if (!taskId) {
      return;
    }

    if (taskStatus === "running") {
      // Connect to SSE stream
      const url = `/api/v1/tasks/${taskId}/stream`;

      try {
        const es = new EventSource(url);
        eventSourceRef.current = es;
        setIsLive(true);

        // Server sends named events (event: <type>), not unnamed messages.
        // Must use addEventListener for each type.
        const EVENT_TYPES = [
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

        const handleNamedEvent = (ev: MessageEvent) => {
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
          } catch (error) {
            console.error("Error parsing SSE event:", error);
          }
        };

        for (const type of EVENT_TYPES) {
          es.addEventListener(type, handleNamedEvent as EventListener);
        }

        es.onerror = () => {
          setIsLive(false);
          es.close();
          eventSourceRef.current = null;
        };
      } catch (error) {
        console.error("Error connecting to SSE:", error);
        setIsLive(false);
      }
    } else if (taskStatus === "completed" || taskStatus === "failed") {
      // Fetch historical data
      const fetchData = async () => {
        try {
          const taskDetail = await fetchTaskWithTelemetry(taskId);

          if (taskDetail && taskDetail.telemetry) {
            // Convert telemetry array to StreamEvent format
            const historicalEvents: StreamEvent[] = taskDetail.telemetry.map(
              (telemetryEntry: TelemetryEntry, index: number) => ({
                id: telemetryEntry.id || `historical-${index}`,
                type: telemetryEntry.eventType || "unknown",
                timestamp: new Date(telemetryEntry.createdAt).getTime(),
                data: (telemetryEntry.data as Record<string, unknown>) || {},
              }),
            );

            setEvents(historicalEvents);
          }
        } catch (error) {
          console.error("Error fetching historical data:", error);
        }
      };

      fetchData();
    }

    // Cleanup function
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [taskId, taskStatus]);

  return { events, isLive };
};
