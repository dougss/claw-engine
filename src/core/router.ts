import type { ClawEngineConfig } from "../config-schema.js";

// description is kept in RouteInput for potential future use (logging, telemetry)
interface RouteInput {
  complexity: "simple" | "medium" | "complex";
  description: string;
  fallbackChainPosition: number;
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
  const { complexity, fallbackChainPosition } = input;
  const chain = config.models.fallback_chain;

  if (fallbackChainPosition > 0 && fallbackChainPosition < chain.length) {
    const tier = chain[fallbackChainPosition];
    return {
      model: tier.model,
      provider: tier.provider,
      mode: "delegate",
      reason: `fallback chain position ${fallbackChainPosition}`,
    };
  }

  if (complexity === "complex") {
    const claudeTier = chain.find((t) => t.provider === "anthropic");
    if (claudeTier) {
      return {
        model: claudeTier.model,
        provider: claudeTier.provider,
        mode: "delegate",
        reason: "complex task → claude -p",
      };
    }
  }

  // simple/medium → opencode delegate
  const opencodeTier = chain.find((t) => t.provider === "opencode");
  if (opencodeTier) {
    return {
      model: opencodeTier.model,
      provider: opencodeTier.provider,
      mode: "delegate",
      reason: "simple/medium task → opencode",
    };
  }

  // last resort: first tier in chain
  return {
    model: chain[0].model,
    provider: chain[0].provider,
    mode: "delegate",
    reason: "fallback to chain[0]",
  };
}
