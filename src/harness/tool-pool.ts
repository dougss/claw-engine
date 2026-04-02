import type { ToolDefinition } from "../types.js";
import type { ToolHandler } from "./tools/tool-types.js";
import type { QueryEngineConfig } from "./query-engine-config.js";
import { TOOL_PROFILE } from "./query-engine-config.js";
import { getToolsByNames } from "./tools/tool-registry.js";

export const TOOL_PROFILES: Record<string, string[]> = {
  [TOOL_PROFILE.full]: [
    "bash",
    "read_file",
    "write_file",
    "edit_file",
    "glob",
    "grep",
    "ask_user",
    "web_fetch",
    "web_search",
    "task_create",
    "task_list",
    "task_update",
    "task_get",
    "spawn_agent",
    "enter_worktree",
    "exit_worktree",
  ],
  [TOOL_PROFILE.simple]: ["read_file", "glob", "grep", "ask_user"],
  [TOOL_PROFILE.readonly]: ["read_file", "glob", "grep"],
  [TOOL_PROFILE.custom]: [],
};

export interface ToolPool {
  tools: ToolHandler[];
  toolNames: string[];
  getDefinitions(): ToolDefinition[];
  getHandler(name: string): ToolHandler | null;
}

export function assembleToolPool({
  config,
}: {
  config: QueryEngineConfig;
}): ToolPool {
  const profileNames =
    config.toolProfile === TOOL_PROFILE.custom
      ? (config.allowedTools ?? [])
      : (TOOL_PROFILES[config.toolProfile] ?? TOOL_PROFILES[TOOL_PROFILE.full]);

  const tools = getToolsByNames(profileNames);
  const toolMap = new Map(tools.map((t) => [t.name, t]));

  return {
    tools,
    get toolNames() {
      return tools.map((t) => t.name);
    },

    getDefinitions(): ToolDefinition[] {
      return tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
    },

    getHandler(name: string): ToolHandler | null {
      return toolMap.get(name) ?? null;
    },
  };
}
