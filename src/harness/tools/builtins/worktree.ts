import { join } from "node:path";
import type { ToolHandler, ToolContext } from "../tool-types.js";
import {
  createWorktree,
  removeWorktree,
} from "../../../integrations/git/worktrees.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

// We extend ToolContext at runtime to stash the pre-worktree path so that
// exit_worktree can restore it.  Using an intersection with Record<string,
// unknown> avoids the need to widen the shared ToolContext interface.
type ExtendedContext = ToolContext & Record<string, unknown>;

const ORIGINAL_PATH_KEY = "_originalWorkspacePath";

export const enterWorktreeTool: ToolHandler = {
  name: "enter_worktree",
  description:
    "Create a git worktree and switch the session into it. " +
    'Example: {"name": "feat-foo"} or {"name": "wt-1", "branch": "feat/bar", "repo": "/path/to/repo"}. ' +
    "Updates workspacePath to the new worktree directory.",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description:
          "Unique identifier for the worktree — used as directory name " +
          "and as the default branch name when branch is omitted.",
      },
      branch: {
        type: "string",
        description:
          "Git branch to create inside the worktree (defaults to name).",
      },
      repo: {
        type: "string",
        description:
          "Absolute path to the git repository (defaults to current workspacePath).",
      },
    },
    required: ["name"],
  },

  async execute(input, context) {
    if (
      !isRecord(input) ||
      typeof input.name !== "string" ||
      input.name.length === 0
    ) {
      return {
        output: "invalid input: expected { name: string }",
        isError: true,
      };
    }

    const name = input.name;
    const branch =
      typeof input.branch === "string" && input.branch.length > 0
        ? input.branch
        : name;
    const repoPath =
      typeof input.repo === "string" && input.repo.length > 0
        ? input.repo
        : context.workspacePath;
    const worktreesDir = join(repoPath, ".worktrees");

    try {
      const { worktreePath } = await createWorktree({
        repoPath,
        worktreesDir,
        taskId: name,
        branch,
      });

      const ext = context as ExtendedContext;
      ext[ORIGINAL_PATH_KEY] = context.workspacePath;
      context.workspacePath = worktreePath;

      return {
        output: JSON.stringify({
          worktreePath,
          originalPath: ext[ORIGINAL_PATH_KEY],
        }),
        isError: false,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { output: message, isError: true };
    }
  },
};

export const exitWorktreeTool: ToolHandler = {
  name: "exit_worktree",
  description:
    "Exit the current git worktree and restore the original workspacePath. " +
    'Example: {"action": "remove"} or {"action": "keep"}.',
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["keep", "remove"],
        description:
          '"keep" — leave the worktree files on disk; ' +
          '"remove" — delete the worktree directory and prune git refs.',
      },
    },
    required: ["action"],
  },

  async execute(input, context) {
    if (
      !isRecord(input) ||
      (input.action !== "keep" && input.action !== "remove")
    ) {
      return {
        output: 'invalid input: expected { action: "keep" | "remove" }',
        isError: true,
      };
    }

    const ext = context as ExtendedContext;
    const originalPath = ext[ORIGINAL_PATH_KEY];

    if (typeof originalPath !== "string") {
      return {
        output:
          "no active worktree: enter_worktree was not called first in this session",
        isError: true,
      };
    }

    const worktreePath = context.workspacePath;

    try {
      if (input.action === "remove") {
        await removeWorktree({ repoPath: originalPath, worktreePath });
      }

      context.workspacePath = originalPath;
      delete ext[ORIGINAL_PATH_KEY];

      return {
        output: JSON.stringify({
          restoredPath: originalPath,
          action: input.action,
        }),
        isError: false,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { output: message, isError: true };
    }
  },
};
