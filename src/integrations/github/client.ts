import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function createPullRequest({
  repo,
  branch,
  title,
  body,
}: {
  repo: string;
  branch: string;
  title: string;
  body: string;
}): Promise<{ url: string; number: number }> {
  const { stdout } = await execFileAsync("gh", [
    "pr",
    "create",
    "--repo",
    repo,
    "--head",
    branch,
    "--title",
    title,
    "--body",
    body,
  ]);
  // gh pr create outputs the PR URL on stdout
  const url = stdout.trim();
  const match = url.match(/\/pull\/(\d+)/);
  const number = match ? parseInt(match[1], 10) : 0;
  return { url, number };
}

export async function createBranch({
  repoPath,
  branch,
  base = "main",
}: {
  repoPath: string;
  branch: string;
  base?: string;
}): Promise<void> {
  await execFileAsync("git", [
    "-C",
    repoPath,
    "checkout",
    "-b",
    branch,
    `origin/${base}`,
  ]);
}
