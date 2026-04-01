#!/usr/bin/env node
/**
 * Global claw binary — wraps `tsx src/cli/index.ts` while preserving the
 * caller's working directory so `claw run . "prompt"` works from any repo.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const tsxBin = join(__dirname, "..", "node_modules", ".bin", "tsx");
const cliEntry = join(__dirname, "..", "src", "cli", "index.ts");

const result = spawnSync(tsxBin, [cliEntry, ...process.argv.slice(2)], {
  stdio: "inherit",
  cwd: process.cwd(), // preserve caller's working directory
});

process.exit(result.status ?? 0);
