import { describe, it, expect } from "vitest";
import { createMockAdapter } from "../../../src/harness/model-adapters/mock-adapter.js";

describe("MockAdapter", () => {
  it("yields scripted events in order across multiple chat calls", async () => {
    const adapter = createMockAdapter({
      name: "test-mock",
      responses: [
        [
          { type: "text_delta", text: "I'll read the file" },
          {
            type: "tool_use",
            id: "t1",
            name: "read_file",
            input: { path: "/tmp/test.txt" },
          },
        ],
        [{ type: "text_delta", text: "Done" }],
      ],
    });

    const events1: unknown[] = [];
    for await (const e of adapter.chat([], [])) {
      events1.push(e);
    }
    expect(events1).toHaveLength(2);
    expect(events1[0]).toEqual({
      type: "text_delta",
      text: "I'll read the file",
    });
    expect(events1[1]).toEqual({
      type: "tool_use",
      id: "t1",
      name: "read_file",
      input: { path: "/tmp/test.txt" },
    });

    const events2: unknown[] = [];
    for await (const e of adapter.chat([], [])) {
      events2.push(e);
    }
    expect(events2).toHaveLength(1);
    expect(events2[0]).toEqual({ type: "text_delta", text: "Done" });

    const events3: unknown[] = [];
    for await (const e of adapter.chat([], [])) {
      events3.push(e);
    }
    expect(events3).toHaveLength(0);
  });

  it("reports correct capabilities", () => {
    const adapter = createMockAdapter({ name: "test", responses: [] });
    expect(adapter.provider).toBe("mock");
    expect(adapter.supportsToolUse).toBe(true);
    expect(adapter.supportsStreaming).toBe(true);
    expect(adapter.costPerInputToken).toBe(0);
    expect(adapter.costPerOutputToken).toBe(0);
    expect(adapter.maxContext).toBe(128000);
  });
});
