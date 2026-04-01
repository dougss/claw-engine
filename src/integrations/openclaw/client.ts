import { execSync } from "node:child_process";

export type AlertType =
  | "budget_high"
  | "needs_review"
  | "escalation_storm"
  | "disk_low"
  | "high_failure_rate"
  | "session_completed"
  | "session_failed";

export interface AlertOptions {
  type: AlertType;
  message: string;
  workItemId?: string;
  taskId?: string;
}

/** Check if we should send an alert based on cooldown. */
export function shouldSendAlert({
  lastSentMs,
  cooldownMs,
}: {
  lastSentMs: number | null;
  cooldownMs: number;
}): boolean {
  if (lastSentMs === null) return true;
  return Date.now() - lastSentMs >= cooldownMs;
}

/** Send an alert via openclaw CLI (Telegram). */
export async function sendAlert(opts: AlertOptions): Promise<void> {
  const prefix = `[claw-engine/${opts.type}]`;
  const parts = [prefix, opts.message];
  if (opts.workItemId) parts.push(`work-item: ${opts.workItemId}`);
  if (opts.taskId) parts.push(`task: ${opts.taskId}`);

  const message = parts.join(" | ");

  try {
    execSync(`openclaw message send "${message.replace(/"/g, '\\"')}"`, {
      stdio: "pipe",
      timeout: 5_000,
    });
  } catch {
    // Alert delivery failure is non-fatal — log and continue
    console.warn(`[openclaw] Failed to send alert: ${message}`);
  }
}
