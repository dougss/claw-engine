export const PERMISSION_ACTION = {
  allow: "allow",
  deny: "deny",
  prompt: "prompt",
} as const;

export type PermissionAction =
  (typeof PERMISSION_ACTION)[keyof typeof PERMISSION_ACTION];

export interface PermissionRule {
  tool: string;
  action: PermissionAction;
  conditions?: {
    path_prefix?: string;
    command_pattern?: string;
  };
}

export const DEFAULT_PERMISSION_RULES: PermissionRule[] = [
  { tool: "read_file", action: "allow" },
  { tool: "glob", action: "allow" },
  { tool: "grep", action: "allow" },
  { tool: "ask_user", action: "allow" },

  {
    tool: "write_file",
    action: "allow",
    conditions: { path_prefix: "<workspace>" },
  },
  { tool: "write_file", action: "deny" },
  {
    tool: "edit_file",
    action: "allow",
    conditions: { path_prefix: "<workspace>" },
  },
  { tool: "edit_file", action: "deny" },

  {
    tool: "bash",
    action: "deny",
    conditions: { command_pattern: "\\brm\\s+-rf\\b" },
  },
  {
    tool: "bash",
    action: "deny",
    conditions: { command_pattern: "\\bgit\\s+push\\s+--force\\b" },
  },
  {
    tool: "bash",
    action: "deny",
    conditions: {
      command_pattern:
        "\\b(drop\\s+(database|table|schema)\\b|truncate\\s+table\\b)\\b",
    },
  },
  {
    tool: "bash",
    action: "deny",
    conditions: { command_pattern: "\\bmkfs\\b" },
  },
  { tool: "bash", action: "allow" },
];

export function evaluatePermission({
  tool,
  input,
  workspacePath,
  rules,
}: {
  tool: string;
  input: unknown;
  workspacePath: string;
  rules: PermissionRule[];
}): { action: PermissionAction; reason: string } {
  const matchingRules = rules.filter((rule) => rule.tool === tool);

  for (const rule of matchingRules) {
    const match = evaluateRuleMatch({ rule, toolInput: input, workspacePath });
    if (!match.isMatch) continue;

    return { action: rule.action, reason: match.reason };
  }

  return {
    action: "prompt",
    reason: `no matching permission rule for tool "${tool}"`,
  };
}

function evaluateRuleMatch({
  rule,
  toolInput,
  workspacePath,
}: {
  rule: PermissionRule;
  toolInput: unknown;
  workspacePath: string;
}): { isMatch: boolean; reason: string } {
  const conditions = rule.conditions;
  if (!conditions) {
    return { isMatch: true, reason: `rule matched (tool "${rule.tool}")` };
  }

  if (conditions.path_prefix !== undefined) {
    const path = extractPathFromToolInput(toolInput);
    if (!path) {
      return {
        isMatch: false,
        reason: "path_prefix condition requires input path",
      };
    }

    const prefix =
      conditions.path_prefix === "<workspace>"
        ? workspacePath
        : conditions.path_prefix;

    if (!isPathWithinPrefix({ path, prefix })) {
      return {
        isMatch: false,
        reason: `path "${path}" is outside allowed prefix "${prefix}"`,
      };
    }

    return {
      isMatch: true,
      reason: `path "${path}" is within allowed prefix "${prefix}"`,
    };
  }

  if (conditions.command_pattern !== undefined) {
    const command = extractCommandFromToolInput(toolInput);
    if (!command) {
      return {
        isMatch: false,
        reason: "command_pattern condition requires bash command input",
      };
    }

    const re = new RegExp(conditions.command_pattern, "i");
    const isMatch = re.test(command);

    return {
      isMatch,
      reason: isMatch
        ? `command matched pattern /${conditions.command_pattern}/i`
        : `command did not match pattern /${conditions.command_pattern}/i`,
    };
  }

  return { isMatch: true, reason: `rule matched (tool "${rule.tool}")` };
}

function extractPathFromToolInput(input: unknown): string | null {
  if (typeof input === "string") return input;
  if (!input || typeof input !== "object") return null;

  const record = input as Record<string, unknown>;
  const candidates = [
    record.path,
    record.filePath,
    record.file_path,
    record.targetFile,
    record.target_file,
    record.filename,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }

  return null;
}

function extractCommandFromToolInput(input: unknown): string | null {
  if (typeof input === "string") return input;
  if (!input || typeof input !== "object") return null;

  const record = input as Record<string, unknown>;
  if (typeof record.command === "string") return record.command;
  if (typeof record.cmd === "string") return record.cmd;

  return null;
}

function isPathWithinPrefix({
  path,
  prefix,
}: {
  path: string;
  prefix: string;
}) {
  const normalizedPrefix = normalizePosixPath(prefix);
  const normalizedPath = normalizePosixPath(path);

  const resolvedPrefix = resolveLikePosix(normalizedPrefix, normalizedPrefix);
  const resolvedPath = resolveLikePosix(normalizedPrefix, normalizedPath);

  const prefixWithSlash = resolvedPrefix.endsWith("/")
    ? resolvedPrefix
    : `${resolvedPrefix}/`;

  return (
    resolvedPath === resolvedPrefix || resolvedPath.startsWith(prefixWithSlash)
  );
}

function normalizePosixPath(input: string) {
  return input.trim().replaceAll("\\", "/");
}

function resolveLikePosix(base: string, target: string) {
  if (target.startsWith("/"))
    return stripTrailingSlash(collapseDotSegments(target));
  return stripTrailingSlash(
    collapseDotSegments(`${stripTrailingSlash(base)}/${target}`),
  );
}

function stripTrailingSlash(input: string) {
  if (input.length <= 1) return input;
  return input.endsWith("/") ? input.slice(0, -1) : input;
}

function collapseDotSegments(path: string) {
  const isAbsolute = path.startsWith("/");
  const parts = path.split("/").filter((part) => part.length > 0);
  const out: string[] = [];

  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") {
      if (out.length > 0) out.pop();
      continue;
    }
    out.push(part);
  }

  return `${isAbsolute ? "/" : ""}${out.join("/")}`;
}
