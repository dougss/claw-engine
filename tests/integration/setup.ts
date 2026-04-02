import { afterEach } from "vitest";
import { getDb } from "../../src/storage/db.js";

const TEST_DB_URL =
  "postgres://claw_engine_test:claw_engine_test@127.0.0.1:5432/claw_engine_test";

afterEach(async () => {
  const db = getDb({ connectionString: TEST_DB_URL });
  await db.execute(
    `TRUNCATE TABLE session_telemetry, routing_history, tasks, work_items, cost_snapshots RESTART IDENTITY CASCADE`,
  );
});
