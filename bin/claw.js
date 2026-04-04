#!/usr/bin/env node
/**
 * Global claw binary.
 *
 * In production (dist/ exists): runs the compiled JS directly — fast, no tsx.
 * In development (no dist/): falls back to tsx for TypeScript source.
 *
 * Preserves the caller's cwd so `claw "prompt"` works from any repo.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distEntry = join(__dirname, "..", "dist", "cli", "index.js");

if (existsSync(distEntry)) {
  // Production: import compiled JS directly (no tsx overhead)
  process.argv[1] = distEntry;
  await import(distEntry);
} else {
  // Development: use tsx to run TypeScript source
  const { spawnSync } = await import("node:child_process");
  const tsxBin = join(__dirname, "..", "node_modules", ".bin", "tsx");
  const srcEntry = join(__dirname, "..", "src", "cli", "index.ts");
  const result = spawnSync(tsxBin, [srcEntry, ...process.argv.slice(2)], {
    stdio: "inherit",
    cwd: process.cwd(),
  });
  process.exit(result.status ?? 0);
}
