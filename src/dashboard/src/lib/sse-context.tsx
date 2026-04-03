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
    const cleanup = createSseClient(
      (event) => {
        subs.current.forEach((fn) => fn(event));
      },
      // onConnected / onDisconnected callbacks
      () => setConnected(true),
      () => setConnected(false),
    );

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
    throw new Error("useSseContext must be used within an SseProvider");
  }
  return { connected: context.connected };
}
