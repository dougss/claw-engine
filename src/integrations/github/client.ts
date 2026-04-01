import { execSync } from "node:child_process";

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
  const safeTitle = title.replace(/"/g, '\\"');
  const safeBody = body.replace(/"/g, '\\"');
  const output = execSync(
    `gh pr create --repo ${repo} --head ${branch} --title "${safeTitle}" --body "${safeBody}" --json url,number`,
    { encoding: "utf-8" },
  );
  return JSON.parse(output) as { url: string; number: number };
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
  execSync(`git -C ${repoPath} checkout -b ${branch} origin/${base}`, {
    stdio: "pipe",
  });
}
