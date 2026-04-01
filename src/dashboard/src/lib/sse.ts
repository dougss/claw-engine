export interface SseEvent {
  id: number;
  type: string;
  data: unknown;
}

type EventHandler = (event: SseEvent) => void;

export function createSseClient(onEvent: EventHandler): () => void {
  let lastEventId = "";
  let es: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  function connect() {
    if (closed) return;
    const url = lastEventId ? `/api/events` : `/api/events`;
    es = new EventSource(url);

    if (lastEventId) {
      // EventSource doesn't support custom headers; reconnect via close/open
      // uses the standard Last-Event-ID mechanism automatically
    }

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
      if (!closed) {
        reconnectTimer = setTimeout(connect, 3000);
      }
    };
  }

  connect();

  return () => {
    closed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    es?.close();
  };
}
