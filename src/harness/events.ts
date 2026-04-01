export type HarnessEvent =
  | { type: "session_start"; sessionId: string; model: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; output: string; isError: boolean }
  | { type: "permission_denied"; tool: string; reason: string }
  | { type: "token_update"; used: number; budget: number; percent: number }
  | { type: "checkpoint"; reason: "token_limit" | "stall" | "manual" }
  | {
      type: "session_end";
      reason: "completed" | "checkpoint" | "error" | "max_iterations";
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
