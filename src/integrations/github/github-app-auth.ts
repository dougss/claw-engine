import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

interface TokenCache {
  token: string;
  expiresAt: number; // Unix ms
}

const tokenCache = new Map<string, TokenCache>();

function base64url(data: Buffer | string): string {
  const buf = typeof data === "string" ? Buffer.from(data) : data;
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

export function makeJwt(appId: string, privateKeyPem: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({ iat: now - 60, exp: now + 600, iss: appId }),
  );
  const signingInput = `${header}.${payload}`;
  const signature = base64url(
    createSign("RSA-SHA256").update(signingInput).sign(privateKeyPem),
  );
  return `${signingInput}.${signature}`;
}

export async function getInstallationToken(
  appId: string,
  installationId: string,
  privateKeyPem: string,
): Promise<string> {
  const cacheKey = `${appId}:${installationId}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.token;
  }

  const jwt = makeJwt(appId, privateKeyPem);

  const response = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `GitHub App token exchange failed: ${response.status} ${body}`,
    );
  }

  const data = (await response.json()) as {
    token: string;
    expires_at: string;
  };

  // Cache for 50 min (tokens expire in 60 min)
  tokenCache.set(cacheKey, {
    token: data.token,
    expiresAt: Date.now() + 50 * 60 * 1000,
  });

  return data.token;
}

export function readPrivateKey(path: string): string {
  return readFileSync(path, "utf-8");
}

/** Exposed for testing only — clears the in-memory token cache. */
export function clearTokenCache(): void {
  tokenCache.clear();
}
