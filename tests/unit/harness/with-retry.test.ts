import { describe, it, expect, vi } from "vitest";
import { withRetry } from "../../../src/harness/model-adapters/with-retry.js";
import type { ModelAdapter } from "../../../src/harness/model-adapters/adapter-types.js";
import type { HarnessEvent } from "../../../src/harness/events.js";

function makeBaseAdapter(
  responses: Array<HarnessEvent[] | (() => AsyncGenerator<HarnessEvent>)>,
): ModelAdapter & { callCount: number } {
  let callIndex = 0;
  const adapter = {
    name: "test-adapter",
    provider: "mock" as const,
    maxContext: 128000,
    supportsToolUse: true,
    supportsStreaming: true,
    costPerInputToken: 0,
    costPerOutputToken: 0,
    callCount: 0,

    async *chat() {
      const response = responses[callIndex] ?? [];
      callIndex++;
      adapter.callCount++;
      if (typeof response === "function") {
        yield* response();
      } else {
        for (const event of response) {
          yield event;
        }
      }
    },
  };
  return adapter;
}

function makeFailingAdapter(
  errors: Array<{
    status?: number;
    code?: string;
    message?: string;
    headers?: Record<string, string>;
  }>,
  successEvents: HarnessEvent[] = [],
): ModelAdapter & { callCount: number } {
  let callIndex = 0;
  const adapter = {
    name: "failing-adapter",
    provider: "mock" as const,
    maxContext: 128000,
    supportsToolUse: true,
    supportsStreaming: true,
    costPerInputToken: 0,
    costPerOutputToken: 0,
    callCount: 0,

    async *chat(): AsyncGenerator<HarnessEvent> {
      const errSpec = errors[callIndex];
      adapter.callCount++;
      callIndex++;

      if (errSpec) {
        const err = Object.assign(new Error(errSpec.message ?? "error"), {
          status: errSpec.status,
          code: errSpec.code,
          headers: errSpec.headers,
        });
        throw err;
      }

      for (const event of successEvents) {
        yield event;
      }
    },
  };
  return adapter;
}

describe("withRetry", () => {
  it("passes through events on first success", async () => {
    const base = makeBaseAdapter([
      [
        { type: "text_delta", text: "hello" },
        { type: "session_end", reason: "completed" },
      ],
    ]);
    const wrapped = withRetry(base, {
      maxRetries: 3,
      baseDelayMs: 1,
      maxDelayMs: 10,
    });

    const events: HarnessEvent[] = [];
    for await (const e of wrapped.chat([], [])) {
      events.push(e);
    }

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("text_delta");
    expect(base.callCount).toBe(1);
  });

  it("retries on 429 with backoff and emits api_retry events", async () => {
    const base = makeFailingAdapter(
      [
        { status: 429, message: "Too Many Requests" },
        { status: 429, message: "Too Many Requests" },
      ],
      [{ type: "text_delta", text: "ok" }],
    );
    const wrapped = withRetry(base, {
      maxRetries: 5,
      baseDelayMs: 1,
      maxDelayMs: 10,
      honorRetryAfter: false,
    });

    vi.useFakeTimers();
    const collectPromise = (async () => {
      const events: HarnessEvent[] = [];
      for await (const e of wrapped.chat([], [])) {
        events.push(e);
      }
      return events;
    })();
    await vi.runAllTimersAsync();
    const events = await collectPromise;
    vi.useRealTimers();

    const retryEvents = events.filter((e) => e.type === "api_retry");
    expect(retryEvents).toHaveLength(2);
    expect(retryEvents[0]).toMatchObject({
      type: "api_retry",
      attempt: 1,
      maxAttempts: 5,
    });
    expect(base.callCount).toBe(3);
  });

  it("does not retry on 401 auth errors", async () => {
    const base = makeFailingAdapter([{ status: 401, message: "Unauthorized" }]);
    const wrapped = withRetry(base, {
      maxRetries: 5,
      baseDelayMs: 1,
      maxDelayMs: 10,
    });

    await expect(async () => {
      for await (const _ of wrapped.chat([], [])) {
        // noop
      }
    }).rejects.toThrow();

    expect(base.callCount).toBe(1);
  });

  it("does not retry on 400 bad request", async () => {
    const base = makeFailingAdapter([{ status: 400, message: "Bad Request" }]);
    const wrapped = withRetry(base, {
      maxRetries: 5,
      baseDelayMs: 1,
      maxDelayMs: 10,
    });

    await expect(async () => {
      for await (const _ of wrapped.chat([], [])) {
        // noop
      }
    }).rejects.toThrow();

    expect(base.callCount).toBe(1);
  });

  it("propagates error after exhausting maxRetries", async () => {
    const base = makeFailingAdapter([
      { status: 429, message: "rate limit" },
      { status: 429, message: "rate limit" },
      { status: 429, message: "rate limit" },
    ]);
    const wrapped = withRetry(base, {
      maxRetries: 2,
      baseDelayMs: 1,
      maxDelayMs: 10,
      honorRetryAfter: false,
    });

    vi.useFakeTimers();
    const collectPromise = (async () => {
      const events: HarnessEvent[] = [];
      try {
        for await (const e of wrapped.chat([], [])) {
          events.push(e);
        }
      } catch {
        // expected
      }
      return events;
    })();
    await vi.runAllTimersAsync();
    const events = await collectPromise;
    vi.useRealTimers();

    const retryEvents = events.filter((e) => e.type === "api_retry");
    expect(retryEvents).toHaveLength(2);
    expect(base.callCount).toBe(3);
  });

  it("respects Retry-After header when honorRetryAfter is true", async () => {
    const base = makeFailingAdapter(
      [{ status: 429, message: "rate limit", headers: { "retry-after": "2" } }],
      [{ type: "text_delta", text: "ok" }],
    );
    const wrapped = withRetry(base, {
      maxRetries: 5,
      baseDelayMs: 100,
      maxDelayMs: 10_000,
      honorRetryAfter: true,
    });

    vi.useFakeTimers();
    const collectPromise = (async () => {
      const events: HarnessEvent[] = [];
      for await (const e of wrapped.chat([], [])) {
        events.push(e);
      }
      return events;
    })();
    await vi.runAllTimersAsync();
    const events = await collectPromise;
    vi.useRealTimers();

    const retryEvent = events.find((e) => e.type === "api_retry");
    expect(retryEvent).toBeDefined();
    if (retryEvent && retryEvent.type === "api_retry") {
      expect(retryEvent.delayMs).toBe(2000);
    }
  });

  it("retries on ECONNRESET", async () => {
    const base = makeFailingAdapter(
      [{ code: "ECONNRESET", message: "Connection reset" }],
      [{ type: "text_delta", text: "ok" }],
    );
    const wrapped = withRetry(base, {
      maxRetries: 3,
      baseDelayMs: 1,
      maxDelayMs: 10,
      honorRetryAfter: false,
    });

    vi.useFakeTimers();
    const collectPromise = (async () => {
      const events: HarnessEvent[] = [];
      for await (const e of wrapped.chat([], [])) {
        events.push(e);
      }
      return events;
    })();
    await vi.runAllTimersAsync();
    const events = await collectPromise;
    vi.useRealTimers();

    const retryEvent = events.find((e) => e.type === "api_retry");
    expect(retryEvent).toBeDefined();
    expect(base.callCount).toBe(2);
  });

  it("preserves adapter metadata on wrapped adapter", () => {
    const base = makeBaseAdapter([[]]);
    const wrapped = withRetry(base);
    expect(wrapped.name).toBe(base.name);
    expect(wrapped.provider).toBe(base.provider);
    expect(wrapped.maxContext).toBe(base.maxContext);
  });
});
