import { describe, it, expect } from "vitest";
import {
  createMemorySessionStore,
  type SessionState,
} from "../../../src/harness/session-store.js";
import { createQueryEngineConfig } from "../../../src/harness/query-engine-config.js";

function makeSessionState(sessionId: string): SessionState {
  return {
    sessionId,
    config: createQueryEngineConfig({ sessionId, workspacePath: "/tmp/test" }),
    transcript: {
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "hi" },
      ],
      compactionCount: 0,
      isFlushed: false,
    },
    usage: {
      totalInputTokens: 500,
      totalOutputTokens: 200,
      turnCount: 3,
      toolCallCount: 5,
      permissionDenialCount: 1,
      currentPercent: 42,
    },
    metadata: {
      startedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      status: "running",
    },
  };
}

describe("SessionStore (memory backend)", () => {
  it("save and load roundtrip", async () => {
    const store = createMemorySessionStore();
    const state = makeSessionState("sess-1");
    await store.save(state);
    const loaded = await store.load("sess-1");
    expect(loaded).toEqual(state);
  });

  it("load returns null for non-existent session", async () => {
    const store = createMemorySessionStore();
    expect(await store.load("nope")).toBeNull();
  });

  it("exists returns true for saved session", async () => {
    const store = createMemorySessionStore();
    await store.save(makeSessionState("sess-2"));
    expect(await store.exists("sess-2")).toBe(true);
    expect(await store.exists("nope")).toBe(false);
  });

  it("delete removes session", async () => {
    const store = createMemorySessionStore();
    await store.save(makeSessionState("sess-3"));
    await store.delete("sess-3");
    expect(await store.load("sess-3")).toBeNull();
  });

  it("list returns all session IDs", async () => {
    const store = createMemorySessionStore();
    await store.save(makeSessionState("a"));
    await store.save(makeSessionState("b"));
    await store.save(makeSessionState("c"));
    const ids = await store.list();
    expect(ids.sort()).toEqual(["a", "b", "c"]);
  });

  it("save overwrites existing session", async () => {
    const store = createMemorySessionStore();
    const original = makeSessionState("sess-4");
    await store.save(original);

    const updated = {
      ...original,
      usage: { ...original.usage, turnCount: 10 },
    };
    await store.save(updated);

    const loaded = await store.load("sess-4");
    expect(loaded?.usage.turnCount).toBe(10);
  });
});
