/**
 * LLM-based task complexity classifier.
 *
 * Replaces the keyword-scoring approach with a single fast LLM call that
 * understands intent semantically. Uses Qwen (cheap, ~50 input + 1 output
 * tokens) with a 8-second timeout. Falls back to "medium" on any error so
 * it never blocks execution.
 */

export type TaskComplexity = "simple" | "medium" | "complex";

export interface ClassifierOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs?: number; // default: 8000
}

const CLASSIFICATION_PROMPT = `You are a task complexity classifier for a coding agent.

Classify the following coding task as exactly one of: simple, medium, or complex.

Definitions:
- simple: mechanical change, 1-2 files, no reasoning needed (add a field, fix a typo, rename a variable, update a constant, copy/move files, update documentation)
- medium: clear goal with defined scope, 2-10 files, standard implementation (add a feature, fix a bug with known location, write tests, implement an interface, add an API endpoint, refactor a module, add telemetry/logging)
- complex: genuinely ambiguous goal OR requires understanding emergent system behavior across many components OR security/auth changes OR no clear implementation path exists without deep investigation first

When in doubt between medium and complex, choose medium.
Most coding tasks — including multi-file features, bug fixes, refactors, and documentation — are medium.
complex should be rare: less than 10% of tasks.

Reply with ONLY the single word: simple, medium, or complex. No explanation.

Task: `;

export async function classifyTask(
  description: string,
  opts: ClassifierOptions,
): Promise<TaskComplexity> {
  const timeoutMs = opts.timeoutMs ?? 8_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${opts.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: opts.model,
        messages: [
          {
            role: "user",
            content: CLASSIFICATION_PROMPT + description,
          },
        ],
        max_tokens: 5,
        temperature: 0,
        stream: false,
      }),
    });

    if (!res.ok) return "medium";

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const raw = data.choices?.[0]?.message?.content?.trim().toLowerCase() ?? "";
    if (raw.startsWith("simple")) return "simple";
    if (raw.startsWith("complex")) return "complex";
    return "medium";
  } catch {
    // Timeout, network error, or parse failure — default to medium
    return "medium";
  } finally {
    clearTimeout(timer);
  }
}
