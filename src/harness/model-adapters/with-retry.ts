import type { Message, ToolDefinition } from "../../types.js";
import type { HarnessEvent } from "../events.js";
import type { ModelAdapter } from "./adapter-types.js";
import type { ClawEngineConfig } from "../../config-schema.js";
import { createAlibabaAdapter } from "./alibaba-adapter.js";

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  honorRetryAfter: boolean;
  fallbackChainPosition?: number;
  config?: ClawEngineConfig;
  apiKey?: string;
  baseUrl?: string;
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
    let currentAdapter = adapter;
    let currentFallbackPosition = resolved.fallbackChainPosition ?? 0;

    while (true) {
      let attempt = 0;

      while (true) {
        try {
          for await (const event of currentAdapter.chat(messages, tools)) {
            yield event;
          }
          return;
        } catch (err) {
          const retryableErr = err as RetryableError;

          if (!isRetryable(retryableErr) || attempt >= resolved.maxRetries) {
            // All retries exhausted for current adapter, check if there's a fallback
            if (resolved.config && resolved.fallbackChainPosition !== undefined) {
              const fallbackChain = resolved.config.models.fallback_chain;
              
              // Find next alibaba tier in the chain (engine→engine fallback only)
              let nextFallbackPosition = -1;
              for (let i = currentFallbackPosition + 1; i < fallbackChain.length; i++) {
                if (fallbackChain[i].provider === "alibaba" && fallbackChain[i].mode === "engine") {
                  nextFallbackPosition = i;
                  break;
                }
              }

              if (nextFallbackPosition !== -1) {
                // Create new adapter with next tier in the chain
                const nextTier = fallbackChain[nextFallbackPosition];
                
                yield {
                  type: "model_fallback",
                  from: currentAdapter.name,
                  to: nextTier.model,
                  reason: retryableErr.message ?? String(err),
                };

                // Create new adapter with the next tier
                currentAdapter = createAlibabaAdapter({
                  name: nextTier.model,
                  model: nextTier.model,
                  apiKey: resolved.apiKey,
                  baseUrl: resolved.baseUrl,
                  maxContext: currentAdapter.maxContext,
                  costPerInputToken: currentAdapter.costPerInputToken,
                  costPerOutputToken: currentAdapter.costPerOutputToken,
                });

                // Update fallback position and reset attempts for the new adapter
                currentFallbackPosition = nextFallbackPosition;
                attempt = 0;
                continue; // Try with the new adapter
              }
            }

            // No fallback available or fallback disabled, re-throw the error
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
