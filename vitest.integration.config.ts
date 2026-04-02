import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    globals: true,
    testTimeout: 30_000,
    hookTimeout: 15_000,
    setupFiles: ["tests/integration/setup.ts"],
    fileParallelism: false,
    env: {
      CLAW_ENGINE_DATABASE_URL:
        "postgres://claw_engine_test:claw_engine_test@127.0.0.1:5432/claw_engine_test",
    },
  },
});
