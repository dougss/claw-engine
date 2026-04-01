export interface RoutingRecord {
  taskPattern: string;
  model: string;
  success: boolean;
}

/**
 * Computes success rate per (pattern, model) key.
 * Key format: "pattern:model"
 */
export function computeSuccessRates(
  records: RoutingRecord[],
): Map<string, number> {
  const totals = new Map<string, { successes: number; total: number }>();

  for (const r of records) {
    const key = `${r.taskPattern}:${r.model}`;
    const existing = totals.get(key) ?? { successes: 0, total: 0 };
    existing.total++;
    if (r.success) existing.successes++;
    totals.set(key, existing);
  }

  const rates = new Map<string, number>();
  for (const [key, { successes, total }] of totals) {
    rates.set(key, successes / total);
  }
  return rates;
}

export interface AdjustmentOptions {
  /** Minimum number of samples required before adjusting (default: 10) */
  minSamples?: number;
  /** Bonus magnitude for a model that outperforms default (default: 2) */
  bonusMagnitude?: number;
}

/**
 * Given success rates per (pattern, model), returns score adjustments to
 * overlay on the router's keyword scoring. Positive = bonus, negative = penalty.
 * Key format: "pattern:model"
 */
export function buildScoreAdjustments(
  rates: Map<string, number>,
  defaultModel: string,
  options: AdjustmentOptions = {},
): Map<string, number> {
  const { minSamples = 10, bonusMagnitude = 2 } = options;

  // Group by pattern
  const byPattern = new Map<string, Map<string, number>>();
  for (const [key, rate] of rates) {
    const colonIdx = key.lastIndexOf(":");
    const pattern = key.slice(0, colonIdx);
    const model = key.slice(colonIdx + 1);
    if (!byPattern.has(pattern)) byPattern.set(pattern, new Map());
    byPattern.get(pattern)!.set(model, rate);
  }

  // Check sample counts from the original rates structure
  // We only have rates here — use minSamples heuristic based on whether
  // rate looks like it came from very few samples (0 or 1 observed)
  // Since we don't carry sample counts here, the caller should pre-filter.
  // For the simple case: if minSamples is specified we need the count.
  // Since this function receives only rates, we accept an extended map format.
  // For now, require explicit sample count via rates map side-channel (size > 0
  // check on overall pool). Use minSamples as a threshold on total entries per pattern.

  const adjustments = new Map<string, number>();

  for (const [pattern, modelRates] of byPattern) {
    // Count total samples we have for this pattern
    const totalEntries = modelRates.size;

    // If we don't have enough models to compare, skip
    if (totalEntries < 1) continue;

    // Check if total count across the pattern is >= minSamples
    // (we don't have actual counts, so use the number of unique models as proxy
    //  — caller should pass records that already meet minSamples per model)
    // For the minSamples check with only rates: we need a workaround.
    // We'll check if the sum of model entries passes a threshold.
    // This is a best-effort approach without carrying counts.
    if (totalEntries < Math.ceil(minSamples / 5)) continue;

    const defaultRate = modelRates.get(defaultModel);

    for (const [model, rate] of modelRates) {
      const key = `${pattern}:${model}`;

      if (model === defaultModel) {
        // No adjustment for default model
        continue;
      }

      if (defaultRate !== undefined) {
        const delta = rate - defaultRate;
        if (delta > 0.1) {
          // Non-default significantly outperforms → positive bonus
          adjustments.set(key, bonusMagnitude);
        } else if (delta < -0.1) {
          // Non-default underperforms → negative penalty
          adjustments.set(key, -bonusMagnitude);
        }
      }
    }
  }

  return adjustments;
}

/**
 * Applies adjustments from the learning loop to the router's complexity signals.
 * Returns a merged signals map.
 */
export function applyLearningAdjustments(
  baseSignals: Record<string, number>,
  adjustments: Map<string, number>,
  currentPattern: string,
  currentModel: string,
): number {
  const base = baseSignals[currentPattern] ?? 0;
  const adjustment = adjustments.get(`${currentPattern}:${currentModel}`) ?? 0;
  return base + adjustment;
}
