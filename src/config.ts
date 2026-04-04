// TODO: Add configuration validation and error handling

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { configSchema, type ClawEngineConfig } from "./config-schema.js";

export function loadConfig(configPath?: string): ClawEngineConfig {
  const path =
    configPath ?? resolve(import.meta.dirname, "../config/config.yaml");
  const raw = readFileSync(path, "utf-8");
  const parsed = parse(raw);
  return configSchema.parse(parsed);
}
