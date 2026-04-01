/**
 * Loads a .env file and populates process.env for keys not already set.
 * Supports KEY=VALUE and KEY="VALUE" syntax. Lines starting with # are comments.
 */
import { readFileSync, existsSync } from "node:fs";

export function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) return;

  const content = readFileSync(filePath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;

    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();

    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // Only set if not already in environment
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

/**
 * Reads env vars declared in openclaw.json's top-level "env" object.
 * Populates process.env for keys not already set.
 */
export function loadOpenClawEnv(): void {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const configPath = `${home}/.openclaw/openclaw.json`;
  if (!existsSync(configPath)) return;

  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const env = parsed["env"];
    if (env && typeof env === "object" && !Array.isArray(env)) {
      for (const [key, value] of Object.entries(
        env as Record<string, unknown>,
      )) {
        if (typeof value === "string" && !process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  } catch {
    // non-critical
  }
}

/** Load standard env files for claw-engine (called at startup). */
export function loadDefaultEnvFiles(): void {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  // OpenClaw shared secrets (DASHSCOPE_API_KEY, BAILIAN_SP_API_KEY, etc.)
  loadEnvFile(`${home}/.openclaw/secrets/.env`);
  // Server-level env
  loadEnvFile(`${home}/server/.env`);
  // OpenClaw JSON config env vars (MOONSHOT_API_KEY, GEMINI_API_KEY, etc.)
  loadOpenClawEnv();
}
