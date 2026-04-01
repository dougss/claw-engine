import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { createRecordedAdapter } from "../../../src/harness/recordings/recorded-adapter.js";
import { serializeEvent } from "../../../src/harness/recordings/recording-format.js";
import type { HarnessEvent } from "../../../src/harness/events.js";

async function writeRecording(path: string, events: HarnessEvent[]) {
  const lines = events.map(serializeEvent).join("\n") + "\n";
  await writeFile(path, lines, "utf8");
}

describe("RecordedAdapter", () => {
  it("replays text events in order", async () => {
    const path = join(tmpdir(), `rec-${Date.now()}.jsonl`);
    await writeRecording(path, [
      { type: "text_delta", text: "first" },
      { type: "text_delta", text: "second" },
    ]);

    const adapter = await createRecordedAdapter({ recordingPath: path });
    const events: HarnessEvent[] = [];
    for await (const e of adapter.chat([], [])) events.push(e);

    expect(events).toEqual([
      { type: "text_delta", text: "first" },
      { type: "text_delta", text: "second" },
    ]);
  });

  it("skips session_end and checkpoint meta-events (loop generates them)", async () => {
    const path = join(tmpdir(), `rec-${Date.now()}.jsonl`);
    await writeRecording(path, [
      { type: "text_delta", text: "hello" },
      { type: "session_end", reason: "completed" },
    ]);

    const adapter = await createRecordedAdapter({ recordingPath: path });
    const events: HarnessEvent[] = [];
    for await (const e of adapter.chat([], [])) events.push(e);

    // session_end is stripped — the agent-loop generates its own
    expect(events).toEqual([{ type: "text_delta", text: "hello" }]);
  });

  it("splits into turns at session_end boundaries", async () => {
    const path = join(tmpdir(), `rec-${Date.now()}.jsonl`);
    await writeRecording(path, [
      { type: "tool_use", id: "t1", name: "bash", input: { command: "ls" } },
      { type: "tool_result", id: "t1", output: "file.ts", isError: false },
      { type: "session_end", reason: "completed" },
      { type: "text_delta", text: "turn 2" },
    ]);

    const adapter = await createRecordedAdapter({ recordingPath: path });

    // Turn 1
    const turn1: HarnessEvent[] = [];
    for await (const e of adapter.chat([], [])) turn1.push(e);
    expect(turn1.some((e) => e.type === "tool_use")).toBe(true);

    // Turn 2
    const turn2: HarnessEvent[] = [];
    for await (const e of adapter.chat([], [])) turn2.push(e);
    expect(turn2).toEqual([{ type: "text_delta", text: "turn 2" }]);
  });

  it("handles empty recording gracefully", async () => {
    const path = join(tmpdir(), `rec-${Date.now()}.jsonl`);
    await writeFile(path, "", "utf8");

    const adapter = await createRecordedAdapter({ recordingPath: path });
    const events: HarnessEvent[] = [];
    for await (const e of adapter.chat([], [])) events.push(e);
    expect(events).toHaveLength(0);
  });

  it("reports correct capabilities", async () => {
    const path = join(tmpdir(), `rec-${Date.now()}.jsonl`);
    await writeFile(path, "", "utf8");

    const adapter = await createRecordedAdapter({
      recordingPath: path,
      name: "my-rec",
    });
    expect(adapter.name).toBe("my-rec");
    expect(adapter.provider).toBe("mock");
    expect(adapter.supportsToolUse).toBe(true);
    expect(adapter.costPerInputToken).toBe(0);
  });
});
