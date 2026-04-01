export const TOOL_PROFILE = {
  full: "full",
  simple: "simple",
  readonly: "readonly",
  custom: "custom",
} as const;

export type ToolProfile = (typeof TOOL_PROFILE)[keyof typeof TOOL_PROFILE];

export const TOKEN_BUDGET_MODE = {
  strict: "strict",
  adaptive: "adaptive",
} as const;

export type TokenBudgetMode =
  (typeof TOKEN_BUDGET_MODE)[keyof typeof TOKEN_BUDGET_MODE];

export interface QueryEngineConfig {
  maxTurns: number;
  maxTokens: number;

  tokenBudgetMode: TokenBudgetMode;
  warningThreshold: number;
  checkpointThreshold: number;
  reserveForSummary: number;

  compactionEnabled: boolean;
  compactionThreshold: number;
  compactionPreserveMessages: number;

  toolProfile: ToolProfile;
  allowedTools?: string[];

  workspacePath: string;
  sessionId: string;
}

export const DEFAULT_QUERY_ENGINE_CONFIG = {
  maxTurns: 200,
  maxTokens: 128_000,
  tokenBudgetMode: TOKEN_BUDGET_MODE.adaptive as TokenBudgetMode,
  warningThreshold: 0.75,
  checkpointThreshold: 0.85,
  reserveForSummary: 10_000,
  compactionEnabled: true,
  compactionThreshold: 0.7,
  compactionPreserveMessages: 4,
  toolProfile: TOOL_PROFILE.full as ToolProfile,
  workspacePath: "/tmp",
  sessionId: "default",
} as const;

export function createQueryEngineConfig(
  overrides: Partial<QueryEngineConfig>,
): QueryEngineConfig {
  const config: QueryEngineConfig = {
    maxTurns: overrides.maxTurns ?? DEFAULT_QUERY_ENGINE_CONFIG.maxTurns,
    maxTokens: overrides.maxTokens ?? DEFAULT_QUERY_ENGINE_CONFIG.maxTokens,
    tokenBudgetMode:
      overrides.tokenBudgetMode ?? DEFAULT_QUERY_ENGINE_CONFIG.tokenBudgetMode,
    warningThreshold:
      overrides.warningThreshold ??
      DEFAULT_QUERY_ENGINE_CONFIG.warningThreshold,
    checkpointThreshold:
      overrides.checkpointThreshold ??
      DEFAULT_QUERY_ENGINE_CONFIG.checkpointThreshold,
    reserveForSummary:
      overrides.reserveForSummary ??
      DEFAULT_QUERY_ENGINE_CONFIG.reserveForSummary,
    compactionEnabled:
      overrides.compactionEnabled ??
      DEFAULT_QUERY_ENGINE_CONFIG.compactionEnabled,
    compactionThreshold:
      overrides.compactionThreshold ??
      DEFAULT_QUERY_ENGINE_CONFIG.compactionThreshold,
    compactionPreserveMessages:
      overrides.compactionPreserveMessages ??
      DEFAULT_QUERY_ENGINE_CONFIG.compactionPreserveMessages,
    toolProfile:
      overrides.toolProfile ?? DEFAULT_QUERY_ENGINE_CONFIG.toolProfile,
    allowedTools: overrides.allowedTools,
    workspacePath:
      overrides.workspacePath ?? DEFAULT_QUERY_ENGINE_CONFIG.workspacePath,
    sessionId: overrides.sessionId ?? DEFAULT_QUERY_ENGINE_CONFIG.sessionId,
  };

  if (config.maxTurns <= 0) {
    throw new Error("maxTurns must be positive");
  }
  if (config.maxTokens <= 0) {
    throw new Error("maxTokens must be positive");
  }
  if (config.compactionThreshold >= config.checkpointThreshold) {
    throw new Error(
      "compactionThreshold must be less than checkpointThreshold",
    );
  }
  if (config.toolProfile === TOOL_PROFILE.custom && !config.allowedTools) {
    throw new Error("allowedTools required when toolProfile is 'custom'");
  }

  return config;
}
