import { execFile, spawn } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { join } from "node:path";

function execFileAsync({
  command,
  args,
  cwd,
}: {
  command: string;
  args: string[];
  cwd?: string;
}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd }, (error, stdout, stderr) => {
      if (error) {
        const wrapped = new Error(
          `${command} ${args.join(" ")} failed: ${stderr || error.message}`,
        );
        (wrapped as Error & { cause?: unknown }).cause = error;
        reject(wrapped);
        return;
      }

      resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
  });
}

function spawnAsync({
  command,
  args,
  cwd,
}: {
  command: string;
  args: string[];
  cwd?: string;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "ignore" });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) return resolve();
      reject(
        new Error(`${command} ${args.join(" ")} exited with code ${code}`),
      );
    });
  });
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function createWorktree({
  repoPath,
  worktreesDir,
  taskId,
  branch,
}: {
  repoPath: string;
  worktreesDir: string;
  taskId: string;
  branch: string;
}): Promise<{ worktreePath: string }> {
  await mkdir(worktreesDir, { recursive: true });

  const worktreePath = join(worktreesDir, taskId);

  // Try checkout existing branch first, fall back to creating new branch
  try {
    await execFileAsync({
      command: "git",
      args: ["-C", repoPath, "worktree", "add", worktreePath, branch],
    });
  } catch {
    await execFileAsync({
      command: "git",
      args: ["-C", repoPath, "worktree", "add", worktreePath, "-b", branch],
    });
  }

  const hasPackageLock = await exists(join(worktreePath, "package-lock.json"));
  if (hasPackageLock) {
    await spawnAsync({ command: "npm", args: ["ci"], cwd: worktreePath });
  }

  return { worktreePath };
}

export async function removeWorktree({
  repoPath,
  worktreePath,
}: {
  repoPath: string;
  worktreePath: string;
}): Promise<void> {
  await execFileAsync({
    command: "git",
    args: ["-C", repoPath, "worktree", "remove", "--force", worktreePath],
  });

  await execFileAsync({
    command: "git",
    args: ["-C", repoPath, "worktree", "prune"],
  });
}

export async function listWorktrees({
  repoPath,
}: {
  repoPath: string;
}): Promise<{ worktreePath: string }[]> {
  const { stdout } = await execFileAsync({
    command: "git",
    args: ["-C", repoPath, "worktree", "list", "--porcelain"],
  });

  const paths: string[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("worktree ")) continue;
    paths.push(trimmed.slice("worktree ".length));
  }

  return paths.map((worktreePath) => ({ worktreePath }));
}
