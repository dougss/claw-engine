import type { SseEventType } from "./api";

export interface SseEvent {
  id: number;
  type: SseEventType;
  data: unknown;
}

type EventHandler = (event: SseEvent) => void;

const RECONNECT_DELAY_MS = 3000;

export function createSseClient(onEvent: EventHandler): () => void {
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

    es.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(ev.data as string) as SseEvent;
        lastEventId = String(parsed.id);
        onEvent(parsed);
      } catch {
        // ignore malformed
      }
    };

    es.onerror = () => {
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
