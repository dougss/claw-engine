import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "../../src/server.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.resolve(__dirname, "../../config/config.yaml");

let app: Awaited<ReturnType<typeof createServer>>["app"];
let redis: Awaited<ReturnType<typeof createServer>>["redis"];

beforeAll(async () => {
  const server = await createServer(CONFIG_PATH);
  app = server.app;
  redis = server.redis;
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await redis.quit();
});

describe("API — work items", () => {
  it("GET /api/work-items returns items array", async () => {
    const res = await app.inject({ method: "GET", url: "/api/work-items" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { items: unknown[]; total: number };
    expect(Array.isArray(body.items)).toBe(true);
    expect(typeof body.total).toBe("number");
  });

  it("GET /api/work-items/:id returns 404 for unknown id", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/work-items/00000000-0000-0000-0000-000000000000",
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("API — metrics", () => {
  it("GET /api/metrics returns metrics shape", async () => {
    const res = await app.inject({ method: "GET", url: "/api/metrics" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      tasks: Record<string, unknown>;
      workItems: Record<string, unknown>;
    };
    expect(body.tasks).toBeDefined();
    expect(typeof body.tasks.total).toBe("number");
    expect(body.workItems).toBeDefined();
    expect(typeof body.workItems.total).toBe("number");
  });
});

describe("API — sessions", () => {
  it("GET /api/sessions returns sessions array", async () => {
    const res = await app.inject({ method: "GET", url: "/api/sessions" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { sessions: unknown[] };
    expect(Array.isArray(body.sessions)).toBe(true);
  });
});

describe("API — logs", () => {
  it("GET /api/logs returns entries array", async () => {
    const res = await app.inject({ method: "GET", url: "/api/logs" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { entries: unknown[]; total: number };
    expect(Array.isArray(body.entries)).toBe(true);
  });
});

describe("API — health", () => {
  it("GET /api/health returns health status", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { status: string; uptime: number };
    expect(body.status).toBe("ok");
    expect(typeof body.uptime).toBe("number");
    expect(body.uptime).toBeGreaterThan(0);
  });
});

describe("API — stats", () => {
  it("GET /api/stats returns 200 with all fields", async () => {
    const res = await app.inject({ method: "GET", url: "/api/stats" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      totalWorkItems: number;
      totalTasks: number;
      totalTokensUsed: number;
      totalCostUsd: number;
      tasksByModel: { model: string; count: number }[];
    };
    expect(typeof body.totalWorkItems).toBe("number");
    expect(typeof body.totalTasks).toBe("number");
    expect(typeof body.totalTokensUsed).toBe("number");
    expect(typeof body.totalCostUsd).toBe("number");
    expect(Array.isArray(body.tasksByModel)).toBe(true);
  });
});
