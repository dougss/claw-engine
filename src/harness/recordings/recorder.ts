import { appendFile, writeFile } from "node:fs/promises";
import type { HarnessEvent } from "../events.js";
import { serializeEvent } from "./recording-format.js";

/**
 * Wraps an AsyncIterable of HarnessEvents, writing each event as a JSONL line
 * to `recordingPath` while passing all events through unchanged.
 *
 * By default truncates the file before writing (set truncate=false to append).
 */
export async function* recordEvents({
  source,
  recordingPath,
  truncate = true,
}: {
  source: AsyncIterable<HarnessEvent>;
  recordingPath: string;
  truncate?: boolean;
}): AsyncGenerator<HarnessEvent> {
  if (truncate) {
    await writeFile(recordingPath, "", "utf8");
  }

  for await (const event of source) {
    await appendFile(recordingPath, serializeEvent(event) + "\n", "utf8");
    yield event;
  }
}
