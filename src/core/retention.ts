export interface TelemetryEventRow {
  id: string;
  eventType: string;
  createdAt: Date;
  taskId: string;
}

export interface RetentionPolicy {
  heartbeatRetentionDays: number;
  eventRetentionDays: number;
}

export interface ClassifyResult {
  toDelete: string[];
  preserved: number;
}

const PRESERVED_EVENT_TYPES = new Set(["cost_snapshot"]);

/**
 * Pure function: classifies telemetry events for deletion based on retention policy.
 * - heartbeat events: delete after `heartbeatRetentionDays`
 * - all other events (except preserved): delete after `eventRetentionDays`
 * - cost_snapshot: never deleted
 */
export function classifyEventsForDeletion(
  events: TelemetryEventRow[],
  now: Date,
  policy: RetentionPolicy,
): ClassifyResult {
  const toDelete: string[] = [];
  let preserved = 0;

  for (const event of events) {
    if (PRESERVED_EVENT_TYPES.has(event.eventType)) {
      preserved++;
      continue;
    }

    const ageMs = now.getTime() - event.createdAt.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);

    const maxDays =
      event.eventType === "heartbeat"
        ? policy.heartbeatRetentionDays
        : policy.eventRetentionDays;

    if (ageDays > maxDays) {
      toDelete.push(event.id);
    } else {
      preserved++;
    }
  }

  return { toDelete, preserved };
}

/**
 * Applies the retention policy to a set of events, returning a summary.
 * Actual deletion is done by the caller via the provided delete function.
 */
export async function applyRetentionPolicy({
  events,
  policy,
  now = new Date(),
  deleteEvents,
}: {
  events: TelemetryEventRow[];
  policy: RetentionPolicy;
  now?: Date;
  deleteEvents: (ids: string[]) => Promise<void>;
}): Promise<{ deleted: number; preserved: number }> {
  const { toDelete, preserved } = classifyEventsForDeletion(
    events,
    now,
    policy,
  );

  if (toDelete.length > 0) {
    await deleteEvents(toDelete);
  }

  return { deleted: toDelete.length, preserved };
}
