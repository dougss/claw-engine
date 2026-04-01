import { describe, it, expect, vi, afterEach } from "vitest";
import { webSearchTool } from "../../../src/harness/tools/builtins/web-search.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("web_search", () => {
  it("formats AbstractText and RelatedTopics (top N)", async () => {
    vi.stubGlobal("fetch", async () => {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          AbstractText: "Hello abstract",
          RelatedTopics: [
            { Text: "A", FirstURL: "https://a.example" },
            { Text: "B", FirstURL: "https://b.example" },
            { Text: "C", FirstURL: "https://c.example" },
          ],
        }),
      } as any;
    });

    const result = await webSearchTool.execute(
      { query: "test", maxResults: 2 },
      { workspacePath: "/tmp", sessionId: "t" },
    );

    expect(result.isError).toBe(false);
    expect(result.output).toContain("Abstract:");
    expect(result.output).toContain("Related:");
    expect(result.output).toContain("https://a.example");
    expect(result.output).toContain("https://b.example");
    expect(result.output).not.toContain("https://c.example");
  });

  it("returns fallback message when empty results", async () => {
    vi.stubGlobal("fetch", async () => {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ AbstractText: "", RelatedTopics: [] }),
      } as any;
    });

    const result = await webSearchTool.execute(
      { query: "nothing" },
      { workspacePath: "/tmp", sessionId: "t" },
    );

    expect(result.isError).toBe(false);
    expect(result.output).toContain("web_fetch");
  });
});
