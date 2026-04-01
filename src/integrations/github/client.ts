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
    "--json",
    "url,number",
  ]);
  return JSON.parse(stdout) as { url: string; number: number };
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
