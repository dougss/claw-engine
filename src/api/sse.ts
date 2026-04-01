import type { Redis } from "ioredis";
import type { FastifyReply } from "fastify";

const SSE_CHANNEL = "claw:events";
const SSE_BUFFER_KEY = "claw:events:buffer";
const SSE_MAX_BUFFER = 500;

export interface SseEvent {
  id: number;
  type: string;
  data: unknown;
}

/** Publish an event to the Redis SSE channel and circular buffer */
export async function publishEvent(
  redis: Redis,
  event: Omit<SseEvent, "id">,
): Promise<void> {
  // Get next id via INCR
  const id = await redis.incr("claw:events:seq");
  const payload: SseEvent = { ...event, id };
  const serialized = JSON.stringify(payload);

  // Push to circular buffer (trim to max 500)
  await redis
    .multi()
    .rpush(SSE_BUFFER_KEY, serialized)
    .ltrim(SSE_BUFFER_KEY, -SSE_MAX_BUFFER, -1)
    .publish(SSE_CHANNEL, serialized)
    .exec();
}

/** Get buffered events since a given id (inclusive) */
export async function getEventsSince(
  redis: Redis,
  sinceId: number,
): Promise<SseEvent[]> {
  const raw = await redis.lrange(SSE_BUFFER_KEY, 0, -1);
  return raw
    .map((s) => JSON.parse(s) as SseEvent)
    .filter((e) => e.id > sinceId);
}

/**
 * Handle a single SSE connection.
 * Replays buffered events if `Last-Event-ID` is present, then subscribes.
 */
export async function handleSseConnection(
  redis: Redis,
  subscriberRedis: Redis,
  reply: FastifyReply,
  lastEventId?: string,
): Promise<void> {
  reply.raw.setHeader("Content-Type", "text/event-stream");
  reply.raw.setHeader("Cache-Control", "no-cache");
  reply.raw.setHeader("Connection", "keep-alive");
  reply.raw.setHeader("X-Accel-Buffering", "no");
  reply.raw.flushHeaders();

  function send(event: SseEvent): void {
    reply.raw.write(`id: ${event.id}\n`);
    reply.raw.write(`event: ${event.type}\n`);
    reply.raw.write(`data: ${JSON.stringify(event.data)}\n\n`);
  }

  // Replay buffered events if reconnecting
  if (lastEventId !== undefined && lastEventId !== "") {
    const since = parseInt(lastEventId, 10);
    if (!Number.isNaN(since)) {
      const buffered = await getEventsSince(redis, since);
      for (const evt of buffered) send(evt);
    }
  }

  // Subscribe to new events
  await subscriberRedis.subscribe(SSE_CHANNEL);

  const onMessage = (_channel: string, message: string) => {
    try {
      const evt = JSON.parse(message) as SseEvent;
      send(evt);
    } catch {
      // ignore malformed messages
    }
  };

  subscriberRedis.on("message", onMessage);

  // Keep-alive ping every 15s
  const pingInterval = setInterval(() => {
    reply.raw.write(": ping\n\n");
  }, 15_000);

  reply.raw.on("close", () => {
    clearInterval(pingInterval);
    subscriberRedis.off("message", onMessage);
    subscriberRedis.unsubscribe(SSE_CHANNEL).catch(() => {});
  });

  // Wait until client disconnects
  await new Promise<void>((resolve) => {
    reply.raw.on("close", resolve);
  });
}
