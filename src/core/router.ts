import type { ClawEngineConfig } from "../config-schema.js";

interface RouteInput {
  complexity: "simple" | "medium" | "complex";
  description: string;
  fallbackChainPosition: number;
  claudeBudgetPercent: number;
}

interface RouteResult {
  model: string;
  provider: string;
  mode: "engine" | "delegate";
  reason: string;
}

export function routeTask(
  input: RouteInput,
  config: ClawEngineConfig,
): RouteResult {
  const {
    complexity,
    description,
    fallbackChainPosition,
    claudeBudgetPercent,
  } = input;
  const chain = config.models.fallback_chain;

  if (fallbackChainPosition > 0 && fallbackChainPosition < chain.length) {
    const tier = chain[fallbackChainPosition];
    return {
      model: tier.model,
      provider: tier.provider,
      mode: tier.mode,
      reason: `fallback chain position ${fallbackChainPosition}`,
    };
  }

  if (
    claudeBudgetPercent >=
    config.providers.anthropic.force_qwen_percent * 100
  ) {
    const qwenTier = chain.find((t) => t.provider === "alibaba");
    if (qwenTier) {
      return {
        model: qwenTier.model,
        provider: qwenTier.provider,
        mode: qwenTier.mode,
        reason: "claude budget exceeded, forcing alibaba",
      };
    }
  }

  if (complexity === "complex") {
    const claudeTier = chain.find((t) => t.mode === "delegate");
    if (claudeTier) {
      return {
        model: claudeTier.model,
        provider: claudeTier.provider,
        mode: claudeTier.mode,
        reason: "complex task → delegate mode",
      };
    }
  }

  if (complexity === "simple") {
    return {
      model: chain[0].model,
      provider: chain[0].provider,
      mode: chain[0].mode,
      reason: "simple task → engine mode",
    };
  }

  const score = computeKeywordScore(
    description,
    config.router.complexity_signals,
  );
  if (score > 0) {
    const claudeTier = chain.find((t) => t.mode === "delegate");
    if (claudeTier) {
      return {
        model: claudeTier.model,
        provider: claudeTier.provider,
        mode: claudeTier.mode,
        reason: `keyword score ${score} > 0 → delegate`,
      };
    }
  }

  return {
    model: chain[0].model,
    provider: chain[0].provider,
    mode: chain[0].mode,
    reason: `keyword score ${score} <= 0 → engine`,
  };
}

export function computeKeywordScore(
  description: string,
  signals: Record<string, number>,
): number {
  const lower = description.toLowerCase();
  let score = 0;
  for (const [keyword, weight] of Object.entries(signals)) {
    if (lower.includes(keyword)) score += weight;
  }
  return score;
}
