export interface SessionHealth {
  sessionId: string;
  lastOutputAt: Date;
  mode: "engine" | "delegate";
  tokensUsed: number;
  tokenBudget: number;
  workspacePath: string;
}

export interface HealthCheckResult {
  sessionId: string;
  action: "continue" | "checkpoint" | "kill";
  reason: string;
}

const STALL_TIMEOUT_ENGINE_MS = 60_000;
const STALL_TIMEOUT_DELEGATE_MS = 300_000;
const MEMORY_LIMIT_BYTES = 2 * 1024 * 1024 * 1024;
const TOKEN_CHECKPOINT_RATIO = 0.85;

export function checkSessionHealth(
  session: SessionHealth,
  opts?: {
    stallTimeoutEngineMs?: number;
    stallTimeoutDelegateMs?: number;
    memoryLimitBytes?: number;
  },
): HealthCheckResult {
  const stallTimeoutEngineMs =
    opts?.stallTimeoutEngineMs ?? STALL_TIMEOUT_ENGINE_MS;
  const stallTimeoutDelegateMs =
    opts?.stallTimeoutDelegateMs ?? STALL_TIMEOUT_DELEGATE_MS;
  const memoryLimitBytes = opts?.memoryLimitBytes ?? MEMORY_LIMIT_BYTES;

  const elapsedMs = Date.now() - session.lastOutputAt.getTime();
  const stallTimeout =
    session.mode === "engine" ? stallTimeoutEngineMs : stallTimeoutDelegateMs;

  if (elapsedMs > stallTimeout) {
    return {
      sessionId: session.sessionId,
      action: "kill",
      reason: `Session stall detected: no output for ${elapsedMs}ms (limit: ${stallTimeout}ms)`,
    };
  }

  const tokenRatio =
    session.tokenBudget > 0 ? session.tokensUsed / session.tokenBudget : 0;
  if (tokenRatio > TOKEN_CHECKPOINT_RATIO) {
    return {
      sessionId: session.sessionId,
      action: "checkpoint",
      reason: `Token budget at ${Math.round(tokenRatio * 100)}% (${session.tokensUsed}/${session.tokenBudget})`,
    };
  }

  const rss = process.memoryUsage().rss;
  if (rss > memoryLimitBytes) {
    return {
      sessionId: session.sessionId,
      action: "kill",
      reason: `Memory usage ${rss} bytes exceeds limit ${memoryLimitBytes} bytes`,
    };
  }

  return {
    sessionId: session.sessionId,
    action: "continue",
    reason: "Session is healthy",
  };
}
