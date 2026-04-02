import { spawn } from "node:child_process";
import type { HarnessEvent } from "../../harness/events.js";

// ── JSON line types from `opencode run --format json` ────────────────────────
// All payload is nested under `part`. Verified against actual opencode output.

export interface OpencodeStreamLine {
  type: string;
  timestamp: number;
  sessionID: string;
  part?: unknown;
  error?: { name?: string; data?: { message?: string; statusCode?: number } };
}

// part shapes
interface PartStepStart {
  type: "step-start";
  snapshot?: string;
}

interface PartText {
  type: "text";
  text: string;
}

interface PartTool {
  type: "tool";
  tool: string; // tool name (e.g. "read", "edit")
  callID: string;
  state?: {
    status?: string;
    input?: unknown;
    output?: string;
  };
}

interface PartStepFinish {
  type: "step-finish";
  reason: "stop" | "tool-calls";
  tokens?: { input?: number; output?: number; total?: number };
  cost?: number;
}

// Max context budget used for token_update percent calculation
const DELEGATE_MAX_CONTEXT = 200_000;

/**
 * Pure parser: converts a single parsed JSON line into zero or more HarnessEvents.
 * Exported for unit testing without spawning subprocesses.
 */
export function* parseOpencodeLine(
  line: OpencodeStreamLine,
  state: { sessionEmitted: boolean; totalTokens: number; model: string },
): Generator<HarnessEvent> {
  if (line.type === "step_start") {
    if (!state.sessionEmitted) {
      state.sessionEmitted = true;
      yield {
        type: "session_start",
        sessionId: line.sessionID,
        model: state.model,
      };
    }
    return;
  }

  if (line.type === "text") {
    const part = line.part as PartText | undefined;
    if (part?.text) {
      yield { type: "text_delta", text: part.text };
    }
    return;
  }

  if (line.type === "tool_use") {
    const part = line.part as PartTool | undefined;
    if (!part?.tool) return;
    yield {
      type: "tool_use",
      id: part.callID ?? `opencode-tool-${line.timestamp}`,
      name: part.tool,
      input: part.state?.input ?? {},
    };
    return;
  }

  if (line.type === "step_finish") {
    const part = line.part as PartStepFinish | undefined;
    const tokens = part?.tokens;
    if (tokens) {
      const stepTokens = (tokens.input ?? 0) + (tokens.output ?? 0);
      state.totalTokens += stepTokens;
      yield {
        type: "token_update",
        used: state.totalTokens,
        budget: DELEGATE_MAX_CONTEXT,
        percent: Math.round((state.totalTokens / DELEGATE_MAX_CONTEXT) * 100),
      };
    }
    return;
  }

  // "error" lines are handled in the main loop to set the error flag
}

// ── Subprocess runner ─────────────────────────────────────────────────────────

export interface OpencodePipeOptions {
  prompt: string;
  model?: string;
  workspacePath?: string;
  /** Hard timeout before killing opencode run. Default: 60 minutes. */
  timeoutMs?: number;
  opencodeBin?: string;
  resumeId?: string;
}

/**
 * Spawns `opencode run <prompt> --format json`, parses the JSONL stream,
 * and yields HarnessEvents. Delegate Mode: OpenCode manages its own tools.
 */
export async function* runOpencodePipe(
  opts: OpencodePipeOptions,
): AsyncGenerator<HarnessEvent> {
  const {
    prompt,
    model,
    workspacePath,
    timeoutMs = 3_600_000, // 60 minutes
    opencodeBin = "opencode",
    resumeId,
  } = opts;

  const args = ["run", "--format", "json"];

  if (model) args.push("--model", model);
  if (workspacePath) args.push("--dir", workspacePath);
  if (resumeId) args.push("--session", resumeId);
  args.push("--", prompt);

  const proc = spawn(opencodeBin, args, {
    cwd: workspacePath,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stderrChunks: Buffer[] = [];
  proc.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

  const exitPromise = new Promise<number>((resolve) => {
    proc.on("close", (code) => resolve(code ?? 1));
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGTERM");
  }, timeoutMs);

  const state = {
    sessionEmitted: false,
    totalTokens: 0,
    model: model ?? "opencode",
  };
  let encounteredError = false;
  let errorMessage = "";

  try {
    let buffer = "";

    for await (const raw of proc.stdout!) {
      buffer += (raw as Buffer).toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let parsed: OpencodeStreamLine;
        try {
          parsed = JSON.parse(trimmed) as OpencodeStreamLine;
        } catch {
          continue;
        }

        if (parsed.type === "error") {
          const err = parsed as OpencodeErrorLine;
          encounteredError = true;
          errorMessage =
            err.error?.data?.message ?? err.error?.name ?? "unknown error";
          continue;
        }

        for (const event of parseOpencodeLine(parsed, state)) {
          yield event;
        }
      }
    }

    const exitCode = await exitPromise;

    if (encounteredError) {
      throw new Error(`opencode error: ${errorMessage}`);
    }

    if (exitCode !== 0) {
      if (exitCode === 143 || exitCode === 130) {
        if (timedOut) {
          throw new Error(
            `opencode run timed out after ${Math.round(timeoutMs / 60_000)} minutes`,
          );
        }
        yield { type: "session_end", reason: "interrupted" };
        return;
      }
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      throw new Error(
        `opencode run exited with code ${exitCode}${stderr ? `: ${stderr}` : ""}`,
      );
    }

    yield { type: "session_end", reason: "completed" };
  } finally {
    clearTimeout(timer);
    if (!proc.killed) proc.kill("SIGTERM");
  }
}
