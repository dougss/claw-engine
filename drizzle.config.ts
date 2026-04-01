import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/storage/schema/index.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.CLAW_ENGINE_DATABASE_URL ??
      "postgres://claw_engine:claw_engine_local@127.0.0.1:5432/claw_engine",
  },
});
