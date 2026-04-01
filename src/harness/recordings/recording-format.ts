import type { HarnessEvent } from "../events.js";

/** One line in a JSONL recording file. */
export interface RecordedEvent {
  /** Unix timestamp in milliseconds when the event was recorded. */
  ts: number;
  event: HarnessEvent;
}

export function serializeEvent(event: HarnessEvent): string {
  const record: RecordedEvent = { ts: Date.now(), event };
  return JSON.stringify(record);
}

export function deserializeEvent(line: string): RecordedEvent {
  return JSON.parse(line) as RecordedEvent;
}

export function parseRecording(content: string): RecordedEvent[] {
  return content
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map(deserializeEvent);
}
