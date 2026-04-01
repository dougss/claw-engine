import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema/index.js";

let dbInstance: ReturnType<typeof drizzle> | null = null;
let pool: pg.Pool | null = null;

export function getDb({ connectionString }: { connectionString: string }) {
  if (!dbInstance) {
    pool = new pg.Pool({ connectionString });
    dbInstance = drizzle(pool, { schema });
  }
  return dbInstance;
}

export async function closeDb() {
  if (!pool) return;
  await pool.end();
  pool = null;
  dbInstance = null;
}
