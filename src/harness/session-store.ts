import type { QueryEngineConfig } from "./query-engine-config.js";
import type { SerializedUsage } from "./usage-tracker.js";
import type { SerializedTranscript } from "./transcript-store.js";

export interface SessionState {
  sessionId: string;
  config: QueryEngineConfig;
  transcript: SerializedTranscript;
  usage: SerializedUsage;
  metadata: {
    startedAt: string;
    lastActivityAt: string;
    status: string;
  };
}

export interface SessionStore {
  save(state: SessionState): Promise<void>;
  load(sessionId: string): Promise<SessionState | null>;
  exists(sessionId: string): Promise<boolean>;
  delete(sessionId: string): Promise<void>;
  list(): Promise<string[]>;
}

export function createMemorySessionStore(): SessionStore {
  const sessions = new Map<string, SessionState>();

  return {
    async save(state) {
      sessions.set(state.sessionId, structuredClone(state));
    },

    async load(sessionId) {
      const state = sessions.get(sessionId);
      return state ? structuredClone(state) : null;
    },

    async exists(sessionId) {
      return sessions.has(sessionId);
    },

    async delete(sessionId) {
      sessions.delete(sessionId);
    },

    async list() {
      return Array.from(sessions.keys());
    },
  };
}

export function createPostgresSessionStore({
  getTaskCheckpointData,
  setTaskCheckpointData,
  listTasksWithCheckpoint,
}: {
  getTaskCheckpointData: (
    taskId: string,
  ) => Promise<Record<string, unknown> | null>;
  setTaskCheckpointData: (
    taskId: string,
    data: Record<string, unknown> | null,
  ) => Promise<void>;
  listTasksWithCheckpoint?: () => Promise<string[]>;
}): SessionStore {
  return {
    async save(state) {
      await setTaskCheckpointData(
        state.sessionId,
        state as unknown as Record<string, unknown>,
      );
    },

    async load(sessionId) {
      const data = await getTaskCheckpointData(sessionId);
      if (!data) return null;
      return data as unknown as SessionState;
    },

    async exists(sessionId) {
      const data = await getTaskCheckpointData(sessionId);
      return data !== null;
    },

    async delete(sessionId) {
      await setTaskCheckpointData(sessionId, null);
    },

    async list() {
      if (!listTasksWithCheckpoint) return [];
      return listTasksWithCheckpoint();
    },
  };
}
