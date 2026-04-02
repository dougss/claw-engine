import type { SessionHealth } from "./health-monitor.js";

export interface ActiveSession {
  health: SessionHealth;
  abort: () => void;
}

/** Global registry of in-flight sessions — populated by runSingleSession, read by daemon health-check loop. */
export const activeSessionRegistry = new Map<string, ActiveSession>();

export function registerSession(sessionId: string, entry: ActiveSession): void {
  activeSessionRegistry.set(sessionId, entry);
}

export function unregisterSession(sessionId: string): void {
  activeSessionRegistry.delete(sessionId);
}
