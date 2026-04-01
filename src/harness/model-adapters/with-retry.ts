import type { Message, ToolDefinition } from "../../types.js";
import type { HarnessEvent } from "../events.js";
import type { ModelAdapter } from "./adapter-types.js";

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  honorRetryAfter: boolean;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 5,
  baseDelayMs: 500,
  maxDelayMs: 32_000,
  honorRetryAfter: true,
};

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503]);
const NON_RETRYABLE_STATUS_CODES = new Set([400, 401, 403, 404]);
const RETRYABLE_ERROR_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "ECONNREFUSED",
]);

export interface RetryableError extends Error {
  status?: number;
  statusCode?: number;
  code?: string;
  headers?: Record<string, string>;
}

function isRetryable(err: RetryableError): boolean {
  const status = err.status ?? err.statusCode;
  if (status !== undefined) {
    if (NON_RETRYABLE_STATUS_CODES.has(status)) return false;
    if (RETRYABLE_STATUS_CODES.has(status)) return true;
    return false;
  }
  if (err.code && RETRYABLE_ERROR_CODES.has(err.code)) return true;
  return false;
}

function getRetryAfterMs(err: RetryableError): number | null {
  const retryAfter =
    err.headers?.["retry-after"] ?? err.headers?.["Retry-After"];
  if (!retryAfter) return null;

  const seconds = parseFloat(retryAfter);
  if (!isNaN(seconds)) return Math.ceil(seconds * 1000);

  const date = new Date(retryAfter);
  if (!isNaN(date.getTime())) {
    return Math.max(0, date.getTime() - Date.now());
  }

  return null;
}

function calcBackoffMs(attempt: number, config: RetryConfig): number {
  const base = Math.min(
    config.baseDelayMs * Math.pow(2, attempt),
    config.maxDelayMs,
  );
  const jitter = base * 0.1 * (Math.random() * 2 - 1);
  return Math.round(base + jitter);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function withRetry(
  adapter: ModelAdapter,
  config?: Partial<RetryConfig>,
): ModelAdapter {
  const resolved: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };

  async function* chat(
    messages: Message[],
    tools: ToolDefinition[],
  ): AsyncGenerator<HarnessEvent> {
    let attempt = 0;

    while (true) {
      try {
        for await (const event of adapter.chat(messages, tools)) {
          yield event;
        }
        return;
      } catch (err) {
        const retryableErr = err as RetryableError;

        if (!isRetryable(retryableErr) || attempt >= resolved.maxRetries) {
          throw err;
        }

        let delayMs: number;
        if (resolved.honorRetryAfter) {
          delayMs =
            getRetryAfterMs(retryableErr) ?? calcBackoffMs(attempt, resolved);
        } else {
          delayMs = calcBackoffMs(attempt, resolved);
        }

        attempt++;

        yield {
          type: "api_retry",
          attempt,
          maxAttempts: resolved.maxRetries,
          delayMs,
          error: retryableErr.message ?? String(err),
        };

        await sleep(delayMs);
      }
    }
  }

  return {
    name: adapter.name,
    provider: adapter.provider,
    maxContext: adapter.maxContext,
    supportsToolUse: adapter.supportsToolUse,
    supportsStreaming: adapter.supportsStreaming,
    costPerInputToken: adapter.costPerInputToken,
    costPerOutputToken: adapter.costPerOutputToken,
    chat,
  };
}
