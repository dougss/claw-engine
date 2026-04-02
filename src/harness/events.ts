export type HarnessEvent =
  | { type: "session_start"; sessionId: string; model: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; output: string; isError: boolean }
  | { type: "permission_denied"; tool: string; reason: string }
  | { type: "token_update"; used: number; budget: number; percent: number }
  | { type: "checkpoint"; reason: "token_limit" | "stall" | "manual" }
  | {
      type: "compaction";
      messagesBefore: number;
      messagesAfter: number;
      compactionCount: number;
    }
  | {
      type: "session_end";
      reason:
        | "completed"
        | "checkpoint"
        | "error"
        | "max_iterations"
        | "interrupted";
    }
  | {
      type: "api_retry";
      attempt: number;
      maxAttempts: number;
      delayMs: number;
      error: string;
    }
  | { type: "model_fallback"; from: string; to: string; reason: string }
  | { type: "session_resume"; sessionId: string; resumeCount: number }
  | {
      type: "validation_result";
      passed: boolean;
      steps: Array<{
        name: string;
        passed: boolean;
        output: string;
        durationMs: number;
      }>;
    };

export function createTextDelta(text: string): HarnessEvent {
  return { type: "text_delta", text };
}

export function createTokenUpdate({
  used,
  budget,
}: {
  used: number;
  budget: number;
}): HarnessEvent & { type: "token_update" } {
  return {
    type: "token_update",
    used,
    budget,
    percent: Math.round((used / budget) * 100),
  };
}

export function isToolUseEvent(
  event: HarnessEvent,
): event is HarnessEvent & { type: "tool_use" } {
  return event.type === "tool_use";
}

export function isSessionEndEvent(
  event: HarnessEvent,
): event is HarnessEvent & { type: "session_end" } {
  return event.type === "session_end";
}

export function isCheckpointEvent(
  event: HarnessEvent,
): event is HarnessEvent & { type: "checkpoint" } {
  return event.type === "checkpoint";
}

export function isCompactionEvent(
  event: HarnessEvent,
): event is HarnessEvent & { type: "compaction" } {
  return event.type === "compaction";
}

export function isApiRetryEvent(
  event: HarnessEvent,
): event is HarnessEvent & { type: "api_retry" } {
  return event.type === "api_retry";
}

export function isModelFallbackEvent(
  event: HarnessEvent,
): event is HarnessEvent & { type: "model_fallback" } {
  return event.type === "model_fallback";
}

export function isSessionResumeEvent(
  event: HarnessEvent,
): event is HarnessEvent & { type: "session_resume" } {
  return event.type === "session_resume";
}
