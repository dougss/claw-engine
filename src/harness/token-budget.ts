export interface TokenBudget {
  maxContext: number;
  warningThreshold: number;
  checkpointThreshold: number;
  reserveForSummary: number;
  warningAt: number;
  checkpointAt: number;
  currentTotal: number;
}

export function estimateTokens(text: string) {
  return Math.ceil(text.length / 4) + 1;
}

export function createTokenBudget({
  maxContext,
  warningThreshold,
  checkpointThreshold,
  reserveForSummary,
}: {
  maxContext: number;
  warningThreshold: number;
  checkpointThreshold: number;
  reserveForSummary: number;
}): TokenBudget {
  const usableContext = Math.max(0, maxContext - reserveForSummary);

  return {
    maxContext,
    warningThreshold,
    checkpointThreshold,
    reserveForSummary,
    warningAt: Math.floor(usableContext * warningThreshold),
    checkpointAt: Math.floor(usableContext * checkpointThreshold),
    currentTotal: 0,
  };
}

export function trackTokens(
  budget: TokenBudget,
  {
    systemPromptTokens,
    messagesTokens,
  }: { systemPromptTokens: number; messagesTokens: number },
) {
  return {
    ...budget,
    currentTotal: systemPromptTokens + messagesTokens,
  };
}

export function shouldWarn(budget: TokenBudget) {
  return budget.currentTotal >= budget.warningAt;
}

export function shouldCheckpoint(budget: TokenBudget) {
  return budget.currentTotal >= budget.checkpointAt;
}
