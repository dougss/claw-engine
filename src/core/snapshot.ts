import { execSync } from "node:child_process";

export interface SnapshotOptions {
  repoPath: string;
}

const GIT_EXEC_TIMEOUT_MS = 300_000;

function gitExecSyncOptions(repoPath: string) {
  return {
    cwd: repoPath,
    encoding: "utf-8" as const,
    timeout: GIT_EXEC_TIMEOUT_MS,
  };
}

/**
 * Creates a git lightweight tag representing the current state of the repository.
 * @param repoPath The path to the git repository
 * @returns The tag name that was created
 */
export function createSnapshot({ repoPath }: SnapshotOptions): string {
  const opts = gitExecSyncOptions(repoPath);
  const timestamp = Date.now();
  const tagName = `claw-snapshot-${timestamp}`;
  
  execSync(`git tag ${tagName} HEAD`, opts);
  
  return tagName;
}

/**
 * Restores the repository to the state represented by the given tag reference.
 * Uses git reset to go back to the tagged commit and git clean to remove untracked files.
 * This approach preserves the current branch state.
 * @param repoPath The path to the git repository
 * @param ref The git reference (tag, commit hash, etc.) to restore to
 */
export function restoreSnapshot({ repoPath, ref }: SnapshotOptions & { ref: string }): void {
  const opts = gitExecSyncOptions(repoPath);
  
  try {
    // Reset the working directory to match the tagged state
    execSync(`git reset --hard ${ref}`, opts);
    
    // Clean untracked files and directories  
    execSync("git clean -fd", opts);
  } catch (error) {
    throw new Error(`Failed to restore snapshot ${ref}: ${(error as Error).message}`);
  }
}

/**
 * Removes a git tag that was created for snapshot purposes.
 * Wrapped in try/catch to ensure it never throws an error.
 * @param repoPath The path to the git repository
 * @param ref The git reference (tag) to remove
 */
export function cleanupSnapshot({ repoPath, ref }: SnapshotOptions & { ref: string }): void {
  try {
    const opts = gitExecSyncOptions(repoPath);
    execSync(`git tag -d ${ref}`, opts);
  } catch {
    // Best effort cleanup - ignore errors
  }
}