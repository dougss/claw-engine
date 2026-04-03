import type { SseEventType } from "./api";

export interface SseEvent {
  id: number;
  type: SseEventType;
  data: unknown;
}

type EventHandler = (event: SseEvent) => void;

const RECONNECT_DELAY_MS = 3000;

export function createSseClient(
  onEvent: EventHandler,
  onConnected?: () => void,
  onDisconnected?: () => void,
): () => void {
  let lastEventId = "";
  let es: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  function clearReconnect() {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function connect() {
    if (closed) return;

    // Always clear any pending reconnect before opening a new connection
    // so we never have two timers racing each other
    clearReconnect();

    const url = lastEventId
      ? `/api/v1/events?lastEventId=${lastEventId}`
      : `/api/v1/events`;

    es = new EventSource(url);

    es.onopen = () => {
      onConnected?.();
    };

    // Server sends named events (event: <type>), not unnamed messages.
    // onmessage only fires for unnamed events, so we must addEventListener
    // for each known type.
    const EVENT_TYPES: SseEventType[] = [
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
      "ping",
    ];

    const handleNamedEvent = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data as string) as Record<string, unknown>;
        const parsed: SseEvent = {
          id: Number(data.id ?? 0),
          type: ev.type as SseEventType,
          data,
        };
        lastEventId = String(parsed.id);
        onEvent(parsed);
      } catch {
        // ignore malformed
      }
    };

    for (const type of EVENT_TYPES) {
      es.addEventListener(type, handleNamedEvent as EventListener);
    }

    es.onerror = () => {
      onDisconnected?.();
      es?.close();
      es = null;
      if (!closed) {
        // Guard: never schedule more than one reconnect timer at a time
        clearReconnect();
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      }
    };
  }

  connect();

  return () => {
    closed = true;
    clearReconnect();
    es?.close();
    es = null;
  };
}
