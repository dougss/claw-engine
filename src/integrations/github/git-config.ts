import { execFileSync } from "node:child_process";

export interface GitAppConfig {
  repoPath: string;
  token: string;
  /** GitHub bot user ID — used to build the noreply email that GitHub maps to the bot. */
  botUserId?: string;
}

export function configureGitForApp({
  repoPath,
  token,
  botUserId,
}: GitAppConfig): void {
  const email = botUserId
    ? `${botUserId}+clawengine[bot]@users.noreply.github.com`
    : "clawengine[bot]@users.noreply.github.com";

  execFileSync("git", ["-C", repoPath, "config", "user.name", "Claw Engine"]);
  execFileSync("git", ["-C", repoPath, "config", "user.email", email]);

  // Rewrite the remote URL to embed the installation token so push/PR work
  // without relying on the system gh auth or SSH keys.
  try {
    const remoteUrl = execFileSync(
      "git",
      ["-C", repoPath, "remote", "get-url", "origin"],
      { encoding: "utf-8" },
    ).trim();

    let authedUrl: string | null = null;

    if (remoteUrl.startsWith("https://")) {
      // Strip any existing embedded credentials before adding new ones
      const clean = remoteUrl.replace(/https:\/\/[^@]+@/, "https://");
      authedUrl = clean.replace("https://", `https://x-access-token:${token}@`);
    } else if (remoteUrl.startsWith("git@github.com:")) {
      // Convert SSH → HTTPS + token
      authedUrl = remoteUrl.replace(
        "git@github.com:",
        `https://x-access-token:${token}@github.com/`,
      );
    }

    if (authedUrl) {
      execFileSync("git", [
        "-C",
        repoPath,
        "remote",
        "set-url",
        "origin",
        authedUrl,
      ]);
    }
  } catch {
    // Remote might not exist yet — not a fatal error
  }
}
