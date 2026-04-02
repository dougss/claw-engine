import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
import { createSseClient, type SseEvent } from "./sse";

type Handler = (event: SseEvent) => void;
type Subscribe = (fn: Handler) => () => void;

const SseContext = createContext<Subscribe | null>(null);

export function SseProvider({ children }: { children: ReactNode }) {
  const subs = useRef<Set<Handler>>(new Set());

  useEffect(() => {
    return createSseClient((event) => {
      subs.current.forEach((fn) => fn(event));
    });
  }, []);

  const subscribe = useCallback<Subscribe>((fn) => {
    subs.current.add(fn);
    return () => subs.current.delete(fn);
  }, []);

  return (
    <SseContext.Provider value={subscribe}>{children}</SseContext.Provider>
  );
}

export function useSseSubscription(handler: Handler): void {
  const subscribe = useContext(SseContext);
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!subscribe) return;
    return subscribe((event) => ref.current(event));
  }, [subscribe]);
}
