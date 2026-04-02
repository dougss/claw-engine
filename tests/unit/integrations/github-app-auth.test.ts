import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import {
  makeJwt,
  getInstallationToken,
  clearTokenCache,
} from "../../../src/integrations/github/github-app-auth.js";

// Generate a real RSA key pair once for all tests
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKeyPem = privateKey.export({
  type: "pkcs8",
  format: "pem",
}) as string;

const APP_ID = "app-123";
const INSTALLATION_ID = "inst-456";
const MOCK_TOKEN = "ghs_testtoken";

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const [, payloadB64] = jwt.split(".");
  return JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
}

function mockFetchSuccess(token = MOCK_TOKEN) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      token,
      expires_at: "2099-01-01T00:00:00Z",
    }),
    text: async () => "",
  });
}

describe("makeJwt", () => {
  it("produces a three-part JWT", () => {
    const jwt = makeJwt(APP_ID, privateKeyPem);
    expect(jwt.split(".")).toHaveLength(3);
  });

  it("header declares RS256 + JWT", () => {
    const jwt = makeJwt(APP_ID, privateKeyPem);
    const [headerB64] = jwt.split(".");
    const header = JSON.parse(
      Buffer.from(headerB64, "base64url").toString("utf-8"),
    );
    expect(header).toEqual({ alg: "RS256", typ: "JWT" });
  });

  it("payload contains iss = appId", () => {
    const jwt = makeJwt(APP_ID, privateKeyPem);
    const payload = decodeJwtPayload(jwt);
    expect(payload.iss).toBe(APP_ID);
  });

  it("payload exp is 660 seconds after iat (60s back-dated + 600s forward)", () => {
    const before = Math.floor(Date.now() / 1000);
    const jwt = makeJwt(APP_ID, privateKeyPem);
    const after = Math.floor(Date.now() / 1000);
    const payload = decodeJwtPayload(jwt);
    const iat = payload.iat as number;
    const exp = payload.exp as number;
    // iat is back-dated by 60s
    expect(iat).toBeGreaterThanOrEqual(before - 60);
    expect(iat).toBeLessThanOrEqual(after - 59);
    // exp is iat + 660
    expect(exp - iat).toBe(660);
  });
});

describe("getInstallationToken", () => {
  beforeEach(() => {
    clearTokenCache();
    vi.restoreAllMocks();
  });

  it("calls the GitHub API and returns the token", async () => {
    vi.stubGlobal("fetch", mockFetchSuccess());

    const token = await getInstallationToken(
      APP_ID,
      INSTALLATION_ID,
      privateKeyPem,
    );

    expect(token).toBe(MOCK_TOKEN);
  });

  it("sends Bearer JWT to the correct endpoint", async () => {
    const fetchMock = mockFetchSuccess();
    vi.stubGlobal("fetch", fetchMock);

    await getInstallationToken(APP_ID, INSTALLATION_ID, privateKeyPem);

    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      RequestInit & { headers: Record<string, string> },
    ];
    expect(url).toBe(
      `https://api.github.com/app/installations/${INSTALLATION_ID}/access_tokens`,
    );
    expect(init.method).toBe("POST");
    expect(init.headers["Authorization"]).toMatch(/^Bearer .+\..+\..+$/);
  });

  it("JWT sent in request has correct iss claim", async () => {
    const fetchMock = mockFetchSuccess();
    vi.stubGlobal("fetch", fetchMock);

    await getInstallationToken(APP_ID, INSTALLATION_ID, privateKeyPem);

    const init = fetchMock.mock.calls[0][1] as {
      headers: Record<string, string>;
    };
    const jwt = init.headers["Authorization"].replace("Bearer ", "");
    const payload = decodeJwtPayload(jwt);
    expect(payload.iss).toBe(APP_ID);
  });

  it("caches the token — second call does not hit fetch", async () => {
    const fetchMock = mockFetchSuccess();
    vi.stubGlobal("fetch", fetchMock);

    const t1 = await getInstallationToken(
      APP_ID,
      INSTALLATION_ID,
      privateKeyPem,
    );
    const t2 = await getInstallationToken(
      APP_ID,
      INSTALLATION_ID,
      privateKeyPem,
    );

    expect(t1).toBe(MOCK_TOKEN);
    expect(t2).toBe(MOCK_TOKEN);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("different installation IDs get separate cache entries", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            token: "token-A",
            expires_at: "2099-01-01T00:00:00Z",
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            token: "token-B",
            expires_at: "2099-01-01T00:00:00Z",
          }),
        }),
    );

    const tA = await getInstallationToken(APP_ID, "inst-A", privateKeyPem);
    const tB = await getInstallationToken(APP_ID, "inst-B", privateKeyPem);

    expect(tA).toBe("token-A");
    expect(tB).toBe("token-B");
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => "Unauthorized",
      }),
    );

    await expect(
      getInstallationToken(APP_ID, INSTALLATION_ID, privateKeyPem),
    ).rejects.toThrow("GitHub App token exchange failed: 401 Unauthorized");
  });
});
