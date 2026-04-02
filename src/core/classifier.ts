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
- medium: clear goal with defined scope, 2-10 files, standard implementation (add a feature, fix a known bug, write tests, implement an interface, add an API endpoint, refactor a module, add telemetry/logging, new integrations with established patterns)
- complex: genuinely ambiguous goal OR requires understanding emergent system behavior across many interdependent components OR no clear implementation path exists without deep investigation first

EXAMPLES:

simple:
- "remove promo block from README" → mechanical text removal, 1 file
- "fix double-slash in import path" → typo fix, 1 file
- "update DeepSeek context window constant from 64k to 128k" → single constant
- "sort skills menu alphabetically" → order change, 1 file

medium:
- "add git slash commands /branch /commit /worktree" → scoped CLI feature, clear structure
- "add LSP client integration with diagnostics and go-to-definition" → new integration, established protocol
- "fix: skip setup flow for third-party providers" → conditional logic, 2-3 files, clear fix
- "implement plugin system with hooks pipeline" → new subsystem, well-defined scope
- "add telemetry events to delegate mode execution" → instrumentation, known touch points
- "fix streaming truncation by draining full response before returning" → known bug, clear fix
- "auto-load CLAUDE.md and AGENTS.md into agent system prompt" → file loading, defined behavior

complex:
- "build interactive CLI with REPL, markdown rendering, and project init" → emergent interactions between subsystems, no clear path
- "runtime engine with session management, tools, MCP client, and compaction" → core architecture, many cross-dependencies, design-heavy
- "investigate why agent loses context across tool call boundaries" → ambiguous root cause, requires deep investigation
- "preserve model-specific thought signatures through tool execution pipeline" → emergent behavior, model-specific quirks, no spec

When in doubt between medium and complex, choose medium.
Most coding tasks are medium. complex must be rare: less than 10% of tasks.

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
