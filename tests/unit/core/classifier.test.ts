import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { classifyTask } from "../../../src/core/classifier.js";

const opts = {
  apiKey: "test-key",
  baseUrl: "https://example.com/v1",
  model: "qwen-test",
};

function mockFetch(content: string, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    json: () =>
      Promise.resolve({
        choices: [{ message: { content } }],
      }),
  });
}

describe("classifyTask", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns "simple" complexity when model responds with "simple"', async () => {
    vi.stubGlobal("fetch", mockFetch('{"complexity": "simple", "title": "rename a variable"}'));
    const result = await classifyTask("rename a variable", opts);
    expect(result.complexity).toBe("simple");
    expect(result.title).toBe("rename a variable");
  });

  it('returns "complex" complexity when model responds with "complex"', async () => {
    vi.stubGlobal("fetch", mockFetch('{"complexity": "complex", "title": "refactor auth architecture"}'));
    const result = await classifyTask("refactor auth architecture", opts);
    expect(result.complexity).toBe("complex");
    expect(result.title).toBe("refactor auth architecture");
  });

  it('returns "medium" when model responds with "medium"', async () => {
    vi.stubGlobal("fetch", mockFetch("medium"));
    expect(await classifyTask("add a new endpoint", opts)).toBe("medium");
  });

  it('returns "medium" as fallback on non-OK response', async () => {
    vi.stubGlobal("fetch", mockFetch("simple", false));
    expect(await classifyTask("any task", opts)).toBe("medium");
  });

  it('returns "medium" as fallback when fetch throws', async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network error")),
    );
    expect(await classifyTask("any task", opts)).toBe("medium");
  });

  it('returns "medium" as fallback on unexpected response content', async () => {
    vi.stubGlobal("fetch", mockFetch("I cannot classify this"));
    expect(await classifyTask("any task", opts)).toBe("medium");
  });

  it("handles leading whitespace and uppercase in response", async () => {
    vi.stubGlobal("fetch", mockFetch("  Simple  "));
    expect(await classifyTask("rename a constant", opts)).toBe("simple");
  });

  it("respects custom timeoutMs option by accepting it without crashing", async () => {
    vi.stubGlobal("fetch", mockFetch("medium"));
    const result = await classifyTask("any task", { ...opts, timeoutMs: 100 });
    expect(result).toBe("medium");
  });

  it("sends correct model and prompt in request body", async () => {
    const fakeFetch = mockFetch("simple");
    vi.stubGlobal("fetch", fakeFetch);

    await classifyTask("add a button to the form", opts);

    const [url, init] = fakeFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.com/v1/chat/completions");

    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("qwen-test");
    expect(body.messages[0].content).toContain("add a button to the form");
    expect(body.max_tokens).toBe(5);
    expect(body.temperature).toBe(0);
  });
});
