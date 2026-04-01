import { describe, it, expect, vi, afterEach } from "vitest";
import { webFetchTool } from "../../../src/harness/tools/builtins/web-fetch.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("web_fetch", () => {
  it("returns text content truncated to maxBytes", async () => {
    vi.stubGlobal("fetch", async () => {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { get: () => "text/plain" },
        text: async () => "a".repeat(200),
      } as any;
    });

    const result = await webFetchTool.execute(
      { url: "https://example.com", maxBytes: 50 },
      { workspacePath: "/tmp", sessionId: "t" },
    );
    expect(result.isError).toBe(false);
    expect(result.output.length).toBeLessThanOrEqual(50);
  });

  it("returns an error for invalid url", async () => {
    const result = await webFetchTool.execute(
      { url: "not a url" },
      { workspacePath: "/tmp", sessionId: "t" },
    );
    expect(result.isError).toBe(true);
  });
});
