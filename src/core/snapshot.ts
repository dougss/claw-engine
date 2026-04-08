import { execFileSync } from "node:child_process";
import { existsSync, lstatSync } from "node:fs";
import { resolve } from "node:path";

export interface SnapshotOptions {
  repoPath: string;
}

const GIT_EXEC_TIMEOUT_MS = 300_000;
const CLAW_SNAPSHOT_PREFIX = "claw-snapshot-";
const VALID_REF_PATTERN = /^claw-snapshot-\d+$/;

function validateRepoPath(repoPath: string): string {
  const resolved = resolve(repoPath);
  if (!existsSync(resolved) || !lstatSync(resolved).isDirectory()) {
    throw new Error(`Invalid repoPath: ${resolved} is not a directory`);
  }
  return resolved;
}

function validateRef(ref: string): void {
  if (!VALID_REF_PATTERN.test(ref)) {
    throw new Error(
      `Invalid snapshot ref: "${ref}" — must match ${CLAW_SNAPSHOT_PREFIX}<timestamp>`,
    );
  }
}

function gitExecOptions(repoPath: string) {
  return {
    cwd: repoPath,
    encoding: "utf-8" as const,
    timeout: GIT_EXEC_TIMEOUT_MS,
  };
}

/**
 * Creates a git lightweight tag representing the current state of the repository.
 * @returns The tag name that was created
 */
export function createSnapshot({ repoPath }: SnapshotOptions): string {
  const safePath = validateRepoPath(repoPath);
  const opts = gitExecOptions(safePath);
  const tagName = `${CLAW_SNAPSHOT_PREFIX}${Date.now()}`;

  execFileSync("git", ["tag", tagName, "HEAD"], opts);

  return tagName;
}

/**
 * Restores the repository to the state represented by the given snapshot tag.
 * Only accepts refs matching the claw-snapshot-<timestamp> pattern.
 */
export function restoreSnapshot({
  repoPath,
  ref,
}: SnapshotOptions & { ref: string }): void {
  const safePath = validateRepoPath(repoPath);
  validateRef(ref);
  const opts = gitExecOptions(safePath);

  try {
    execFileSync("git", ["reset", "--hard", ref], opts);
    execFileSync("git", ["clean", "-fd"], opts);
  } catch (error) {
    throw new Error(
      `Failed to restore snapshot ${ref}: ${(error as Error).message}`,
    );
  }
}

/**
 * Removes a snapshot tag. Idempotent — silently ignores already-deleted tags.
 */
export function cleanupSnapshot({
  repoPath,
  ref,
}: SnapshotOptions & { ref: string }): void {
  try {
    validateRef(ref);
    const safePath = validateRepoPath(repoPath);
    const opts = gitExecOptions(safePath);
    execFileSync("git", ["tag", "-d", ref], opts);
  } catch {
    // Best effort cleanup — ignore errors (tag may already be deleted)
  }
}
