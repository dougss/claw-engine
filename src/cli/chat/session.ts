import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { promises as fs } from "node:fs";

export interface ChatTurn {
  prompt: string;
  tokensUsed: number;
  endReason: string;
  timestamp: number;
}

export interface ChatSession {
  id: string;
  repoPath: string;
  complexity: "simple" | "medium" | "complex";
  provider: string;
  model: string;
  branch: string | null;
  turns: ChatTurn[];
  totalTokens: number;
  flags: {
    forcePipeline: boolean;
    forceDelegate: boolean;
  };
}

// Session storage functions
const SESSIONS_DIR = join(homedir(), ".claw-engine", "sessions");

async function ensureSessionDir(): Promise<void> {
  await fs.mkdir(SESSIONS_DIR, { recursive: true });
}

export async function saveSession(session: ChatSession): Promise<void> {
  await ensureSessionDir();
  const sessionPath = join(SESSIONS_DIR, `${session.id}.json`);
  await fs.writeFile(sessionPath, JSON.stringify(session, null, 2));
}

export async function loadSession(id: string): Promise<ChatSession | null> {
  const sessionPath = join(SESSIONS_DIR, `${id}.json`);
  try {
    const content = await fs.readFile(sessionPath, "utf-8");
    return JSON.parse(content);
  } catch (err) {
    return null;
  }
}

export async function listSessions(): Promise<string[]> {
  try {
    await ensureSessionDir();
    const files = await fs.readdir(SESSIONS_DIR);
    return files
      .filter((file) => file.endsWith(".json"))
      .map((file) => file.slice(0, -5)); // Remove '.json' extension
  } catch (err) {
    return [];
  }
}

export function createSession(opts: {
  repoPath: string;
  complexity: "simple" | "medium" | "complex";
  provider: string;
  model: string;
}): ChatSession {
  return {
    id: randomUUID(),
    repoPath: opts.repoPath,
    complexity: opts.complexity,
    provider: opts.provider,
    model: opts.model,
    branch: null,
    turns: [],
    totalTokens: 0,
    flags: { forcePipeline: false, forceDelegate: false },
  };
}

export function addTurn(
  session: ChatSession,
  turn: { prompt: string; tokensUsed: number; endReason: string },
): void {
  session.turns.push({ ...turn, timestamp: Date.now() });
  session.totalTokens += turn.tokensUsed;
}

export function getTurnSummary(session: ChatSession): string {
  return session.turns
    .map(
      (t, i) =>
        `Turn ${i + 1}: "${t.prompt.slice(0, 80)}" (${t.endReason}, ${t.tokensUsed} tokens)`,
    )
    .join("\n");
}
