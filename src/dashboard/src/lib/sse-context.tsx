import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useCallback,
  useState,
  type ReactNode,
} from "react";
import { createSseClient, type SseEvent } from "./sse";

type Handler = (event: SseEvent) => void;
type Subscribe = (fn: Handler) => () => void;

interface SseContextValue {
  subscribe: Subscribe;
  connected: boolean;
}

const SseContext = createContext<SseContextValue | null>(null);

export function SseProvider({ children }: { children: ReactNode }) {
  const subs = useRef<Set<Handler>>(new Set());
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    // Track connection state through the SSE client
    const cleanup = createSseClient((event) => {
      // Successfully received an event means we're connected
      setConnected(true);
      subs.current.forEach((fn) => fn(event));
    });

    // When we set up the SSE client, we assume we're attempting to connect
    setConnected(false);

    return cleanup;
  }, []);

  const subscribe = useCallback<Subscribe>((fn) => {
    subs.current.add(fn);
    return () => subs.current.delete(fn);
  }, []);

  return (
    <SseContext.Provider value={{ subscribe, connected }}>
      {children}
    </SseContext.Provider>
  );
}

export function useSseSubscription(handler: Handler): void {
  const context = useContext(SseContext);
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!context) return;
    return context.subscribe((event) => ref.current(event));
  }, [context]);
}

export function useSseContext() {
  const context = useContext(SseContext);
  if (!context) {
    throw new Error('useSseContext must be used within an SseProvider');
  }
  return { connected: context.connected };
}
