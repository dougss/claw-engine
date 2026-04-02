import { spawn } from "node:child_process";
import type { HarnessEvent } from "../../harness/events.js";

// ── JSON line types from `claude -p --output-format stream-json` ─────────────

export type ClaudeStreamLine =
  | ClaudeSystemLine
  | ClaudeAssistantLine
  | ClaudeUserLine
  | ClaudeResultLine
  | { type: string };

export interface ClaudeSystemLine {
  type: "system";
  subtype: "init";
  session_id: string;
  model: string;
  tools: unknown[];
}

export interface ClaudeAssistantLine {
  type: "assistant";
  message: {
    id: string;
    role: "assistant";
    content: Array<
      | { type: "text"; text: string }
      | { type: "tool_use"; id: string; name: string; input: unknown }
    >;
  };
}

export interface ClaudeUserLine {
  type: "user";
  message: {
    role: "user";
    content: Array<{
      type: "tool_result";
      tool_use_id: string;
      content: Array<{ type: "text"; text: string }>;
    }>;
  };
}

export interface ClaudeResultLine {
  type: "result";
  subtype: "success" | "error_during_execution" | "max_turns";
  result?: string;
  error?: string;
  session_id: string;
  cost_usd?: number;
  usage?: { input_tokens: number; output_tokens: number };
}

// Max context budget used for token_update percent calculation in Delegate Mode
const DELEGATE_MAX_CONTEXT = 200_000;

/**
 * Pure parser: converts a single parsed JSON line into zero or more HarnessEvents.
 * Exported for unit testing without spawning subprocesses.
 */
export function* parseClaudeLine(
  line: ClaudeStreamLine,
): Generator<HarnessEvent> {
  if (line.type === "system") {
    const init = line as ClaudeSystemLine;
    yield {
      type: "session_start",
      sessionId: init.session_id,
      model: init.model,
    };
    return;
  }

  if (line.type === "assistant") {
    const asst = line as ClaudeAssistantLine;
    for (const block of asst.message.content) {
      if (block.type === "text") {
        yield { type: "text_delta", text: block.text };
      } else if (block.type === "tool_use") {
        yield {
          type: "tool_use",
          id: block.id,
          name: block.name,
          input: block.input,
        };
      }
    }
    return;
  }

  if (line.type === "result") {
    const result = line as ClaudeResultLine;
    if (result.usage) {
      const used = result.usage.input_tokens + result.usage.output_tokens;
      yield {
        type: "token_update",
        used,
        budget: DELEGATE_MAX_CONTEXT,
        percent: Math.round((used / DELEGATE_MAX_CONTEXT) * 100),
      };
    }
    if (result.subtype === "success") {
      yield { type: "session_end", reason: "completed" };
    } else if (result.subtype === "max_turns") {
      yield { type: "session_end", reason: "max_iterations" };
    } else {
      yield { type: "session_end", reason: "error" };
    }
    return;
  }

  // "user" (tool_result confirmations) and unknown types → no events
}

// ── Subprocess runner ─────────────────────────────────────────────────────────

export interface ClaudePipeOptions {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  allowedTools?: string[];
  workspacePath?: string;
  /** Hard timeout before killing claude -p. Default: 60 minutes. */
  timeoutMs?: number;
  claudeBin?: string;
  maxTurns?: number;
}

/**
 * Spawns `claude -p <prompt> --output-format stream-json`, parses the JSONL
 * stream, and yields HarnessEvents. Delegate Mode: Claude manages its own tools.
 */
export async function* runClaudePipe(
  opts: ClaudePipeOptions,
): AsyncGenerator<HarnessEvent> {
  const {
    prompt,
    systemPrompt,
    model,
    allowedTools,
    workspacePath,
    timeoutMs = 3_600_000, // 60 minutes
    claudeBin = "claude",
    maxTurns,
  } = opts;

  const args = ["-p", prompt, "--output-format", "stream-json", "--verbose"];

  if (systemPrompt) args.push("--system-prompt", systemPrompt);
  if (model) args.push("--model", model);
  if (maxTurns !== undefined) args.push("--max-turns", String(maxTurns));
  if (allowedTools && allowedTools.length > 0) {
    args.push("--allowedTools", allowedTools.join(","));
  }

  const proc = spawn(claudeBin, args, {
    cwd: workspacePath,
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Collect stderr for error reporting
  const stderrChunks: Buffer[] = [];
  proc.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

  // Exit code promise (resolved after stdout closes)
  const exitPromise = new Promise<number>((resolve) => {
    proc.on("close", (code) => resolve(code ?? 1));
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGTERM");
  }, timeoutMs);

  let sawResultLine = false;

  try {
    let buffer = "";

    for await (const raw of proc.stdout!) {
      buffer += (raw as Buffer).toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let parsed: ClaudeStreamLine;
        try {
          parsed = JSON.parse(trimmed) as ClaudeStreamLine;
        } catch {
          continue;
        }

        for (const event of parseClaudeLine(parsed)) {
          yield event;
        }

        if (parsed.type === "result") {
          sawResultLine = true;
          return; // generator done; finally will clean up
        }
      }
    }

    // stdout closed without a result line — check exit code
    const exitCode = await exitPromise;
    if (exitCode !== 0) {
      // 143 = SIGTERM (128+15), 130 = SIGINT (128+2)
      if (exitCode === 143 || exitCode === 130) {
        if (timedOut) {
          throw new Error(
            `claude -p timed out after ${Math.round(timeoutMs / 60_000)} minutes`,
          );
        }
        yield { type: "session_end" as const, reason: "interrupted" };
        return;
      }
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      throw new Error(
        `claude -p exited with code ${exitCode}${stderr ? `: ${stderr}` : ""}`,
      );
    }

    if (!sawResultLine) {
      // Process exited 0 but never sent a result line — treat as completed
      yield { type: "session_end", reason: "completed" };
    }
  } finally {
    clearTimeout(timer);
    if (!proc.killed) proc.kill("SIGTERM");
  }
}
