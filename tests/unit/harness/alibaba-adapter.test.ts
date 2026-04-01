import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createAlibabaAdapter } from "../../../src/harness/model-adapters/alibaba-adapter.js";
import type { HarnessEvent } from "../../../src/harness/events.js";

// Build a fake SSE body from individual data lines
function sseBody(...dataLines: string[]): string {
  return dataLines.map((d) => `data: ${d}\n\n`).join("") + "data: [DONE]\n\n";
}

function makeStreamResponse(body: string, status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("AlibabaAdapter", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const adapter = createAlibabaAdapter({
    name: "test-qwen",
    model: "qwen-turbo",
    apiKey: "test-key",
  });

  it("emits text_delta events and session_end on stop", async () => {
    const body = sseBody(
      JSON.stringify({
        choices: [
          { delta: { role: "assistant", content: "" }, finish_reason: null },
        ],
      }),
      JSON.stringify({
        choices: [{ delta: { content: "Hello" }, finish_reason: null }],
      }),
      JSON.stringify({
        choices: [{ delta: { content: " World" }, finish_reason: null }],
      }),
      JSON.stringify({
        choices: [{ delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    );

    vi.mocked(fetch).mockResolvedValueOnce(makeStreamResponse(body));

    const events: HarnessEvent[] = [];
    for await (const e of adapter.chat([{ role: "user", content: "hi" }], [])) {
      events.push(e);
    }

    const textDeltas = events.filter((e) => e.type === "text_delta");
    expect(textDeltas).toHaveLength(2);
    expect((textDeltas[0] as { text: string }).text).toBe("Hello");
    expect((textDeltas[1] as { text: string }).text).toBe(" World");

    const tokenUpdate = events.find((e) => e.type === "token_update");
    expect(tokenUpdate).toMatchObject({ type: "token_update", used: 15 });

    expect(events[events.length - 1]).toEqual({
      type: "session_end",
      reason: "completed",
    });
  });

  it("emits tool_use event when finish_reason is tool_calls", async () => {
    const body = sseBody(
      JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_abc",
                  type: "function",
                  function: { name: "bash", arguments: "" },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      }),
      JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, function: { arguments: '{"command":"ls"}' } },
              ],
            },
            finish_reason: null,
          },
        ],
      }),
      JSON.stringify({
        choices: [{ delta: {}, finish_reason: "tool_calls" }],
      }),
    );

    vi.mocked(fetch).mockResolvedValueOnce(makeStreamResponse(body));

    const events: HarnessEvent[] = [];
    for await (const e of adapter.chat(
      [{ role: "user", content: "list files" }],
      [],
    )) {
      events.push(e);
    }

    const toolUse = events.find((e) => e.type === "tool_use");
    expect(toolUse).toMatchObject({
      type: "tool_use",
      id: "call_abc",
      name: "bash",
      input: { command: "ls" },
    });
  });

  it("handles multiple tool calls in one stream", async () => {
    const body = sseBody(
      JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "id1",
                  type: "function",
                  function: { name: "bash", arguments: '{"command":"pwd"}' },
                },
                {
                  index: 1,
                  id: "id2",
                  type: "function",
                  function: {
                    name: "read_file",
                    arguments: '{"path":"/tmp/a"}',
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      }),
      JSON.stringify({
        choices: [{ delta: {}, finish_reason: "tool_calls" }],
      }),
    );

    vi.mocked(fetch).mockResolvedValueOnce(makeStreamResponse(body));

    const events: HarnessEvent[] = [];
    for await (const e of adapter.chat([], [])) events.push(e);

    const toolUses = events.filter((e) => e.type === "tool_use");
    expect(toolUses).toHaveLength(2);
    expect(toolUses[0]).toMatchObject({
      name: "bash",
      input: { command: "pwd" },
    });
    expect(toolUses[1]).toMatchObject({
      name: "read_file",
      input: { path: "/tmp/a" },
    });
  });

  it("throws on non-OK HTTP response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('{"error":{"message":"Unauthorized"}}', { status: 401 }),
    );

    await expect(async () => {
      for await (const _ of adapter.chat([], [])) {
        /* drain */
      }
    }).rejects.toThrow("HTTP 401");
  });

  it("throws when apiKey is missing", async () => {
    const noKey = createAlibabaAdapter({ name: "no-key", model: "qwen-turbo" });

    await expect(async () => {
      for await (const _ of noKey.chat([], [])) {
        /* drain */
      }
    }).rejects.toThrow("missing apiKey");
  });

  it("inserts synthetic assistant tool_calls before tool result messages", async () => {
    // Verify that message translation doesn't throw for round 2 (tool result present)
    let capturedBody: string | undefined;
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      capturedBody = init?.body as string;
      const body = sseBody(
        JSON.stringify({
          choices: [{ delta: { content: "done" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 5, completion_tokens: 2 },
        }),
      );
      return makeStreamResponse(body);
    });

    const messages = [
      { role: "system" as const, content: "You are helpful" },
      { role: "user" as const, content: "do it" },
      {
        role: "tool" as const,
        content: "output",
        toolUseId: "call_xyz",
        toolName: "bash",
      },
    ];

    for await (const _ of adapter.chat(messages, [])) {
      /* drain */
    }

    const parsed = JSON.parse(capturedBody!);
    const msgs = parsed.messages as Array<{
      role: string;
      tool_calls?: unknown[];
    }>;

    // There should be a synthetic assistant tool_calls message before the tool result
    const assistantIdx = msgs.findIndex(
      (m) => m.role === "assistant" && Array.isArray(m.tool_calls),
    );
    const toolIdx = msgs.findIndex((m) => m.role === "tool");
    expect(assistantIdx).toBeGreaterThanOrEqual(0);
    expect(toolIdx).toBe(assistantIdx + 1);
  });

  it("reports correct adapter capabilities", () => {
    expect(adapter.provider).toBe("alibaba");
    expect(adapter.name).toBe("test-qwen");
    expect(adapter.supportsToolUse).toBe(true);
    expect(adapter.supportsStreaming).toBe(true);
    expect(adapter.maxContext).toBe(128000);
  });
});
