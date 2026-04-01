export interface UsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  turnCount: number;
  toolCallCount: number;
  permissionDenialCount: number;
}

export interface SerializedUsage extends UsageSummary {
  currentPercent: number;
}

export interface UsageTracker {
  currentPercent: number;
  addTurn(params: { inputTokens: number; outputTokens: number }): void;
  addToolCall(): void;
  addPermissionDenial(): void;
  updateTokenPercent(percent: number): void;
  getSummary(): UsageSummary;
  toSerializable(): SerializedUsage;
}

export function createUsageTracker(opts?: {
  fromSerialized?: SerializedUsage;
}): UsageTracker {
  let totalInputTokens = opts?.fromSerialized?.totalInputTokens ?? 0;
  let totalOutputTokens = opts?.fromSerialized?.totalOutputTokens ?? 0;
  let turnCount = opts?.fromSerialized?.turnCount ?? 0;
  let toolCallCount = opts?.fromSerialized?.toolCallCount ?? 0;
  let permissionDenialCount = opts?.fromSerialized?.permissionDenialCount ?? 0;
  let currentPercent = opts?.fromSerialized?.currentPercent ?? 0;

  return {
    get currentPercent() {
      return currentPercent;
    },

    addTurn({ inputTokens, outputTokens }) {
      totalInputTokens += inputTokens;
      totalOutputTokens += outputTokens;
      turnCount++;
    },

    addToolCall() {
      toolCallCount++;
    },

    addPermissionDenial() {
      permissionDenialCount++;
    },

    updateTokenPercent(percent: number) {
      currentPercent = percent;
    },

    getSummary(): UsageSummary {
      return {
        totalInputTokens,
        totalOutputTokens,
        turnCount,
        toolCallCount,
        permissionDenialCount,
      };
    },

    toSerializable(): SerializedUsage {
      return {
        totalInputTokens,
        totalOutputTokens,
        turnCount,
        toolCallCount,
        permissionDenialCount,
        currentPercent,
      };
    },
  };
}
