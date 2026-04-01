import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { lt } from "drizzle-orm";
import { loadConfig } from "../../config.js";
import { applyRetentionPolicy } from "../../core/retention.js";

export function registerCleanupCommand(program: import("commander").Command) {
  program
    .command("cleanup")
    .description("Clean up orphan worktrees, old telemetry data")
    .option("--dry-run", "Show what would be cleaned without deleting")
    .action(async (opts: { dryRun?: boolean }) => {
      const config = loadConfig();
      const worktreesDir = config.engine.worktrees_dir.replace("~", homedir());
      const isDryRun = opts.dryRun ?? false;

      console.log(isDryRun ? "[dry-run] Scanning..." : "Cleaning up...");

      // 1. Orphan worktrees
      let orphanCount = 0;
      try {
        const entries = await readdir(worktreesDir, { withFileTypes: true });
        const dirs = entries.filter((e) => e.isDirectory());

        // Check each dir against DB
        const { getDb } = await import("../../storage/db.js");
        const connStr =
          process.env.CLAW_ENGINE_DATABASE_URL ??
          (() => {
            const pw = process.env[config.database.password_env] ?? "";
            return `postgresql://${config.database.user}:${pw}@${config.database.host}:${config.database.port}/${config.database.database}`;
          })();
        const db = getDb({ connectionString: connStr });
        const { tasks } = await import("../../storage/schema/index.js");
        const { inArray } = await import("drizzle-orm");
        const ACTIVE = [
          "pending",
          "provisioning",
          "starting",
          "running",
          "checkpointing",
          "validating",
          "needs_human_review",
          "interrupted",
          "resuming",
          "merging_dependency",
          "stalled",
          "blocked",
        ];
        const activeTasks = await db
          .select({ id: tasks.id })
          .from(tasks)
          .where(inArray(tasks.status, ACTIVE));
        const activeIds = new Set(activeTasks.map((t) => t.id));

        for (const dir of dirs) {
          if (!activeIds.has(dir.name)) {
            orphanCount++;
            if (!isDryRun) {
              await rm(join(worktreesDir, dir.name), {
                recursive: true,
                force: true,
              });
            }
          }
        }
      } catch {
        // Worktrees dir may not exist yet
      }

      // 2. Old telemetry
      let telemetryDeleted = 0;
      try {
        const { getDb } = await import("../../storage/db.js");
        const connStr =
          process.env.CLAW_ENGINE_DATABASE_URL ??
          (() => {
            const pw = process.env[config.database.password_env] ?? "";
            return `postgresql://${config.database.user}:${pw}@${config.database.host}:${config.database.port}/${config.database.database}`;
          })();
        const db = getDb({ connectionString: connStr });
        const { sessionTelemetry } =
          await import("../../storage/schema/index.js");

        const allEvents = await db
          .select({
            id: sessionTelemetry.id,
            eventType: sessionTelemetry.eventType,
            createdAt: sessionTelemetry.createdAt,
            taskId: sessionTelemetry.taskId,
          })
          .from(sessionTelemetry);

        const result = await applyRetentionPolicy({
          events: allEvents.map((e) => ({
            id: e.id,
            eventType: e.eventType ?? "unknown",
            createdAt: new Date(e.createdAt),
            taskId: e.taskId ?? "",
          })),
          policy: {
            heartbeatRetentionDays:
              config.cleanup.telemetry_heartbeat_retention_days,
            eventRetentionDays: config.cleanup.telemetry_events_retention_days,
          },
          deleteEvents: async (ids) => {
            if (!isDryRun) {
              const { inArray } = await import("drizzle-orm");
              await db
                .delete(sessionTelemetry)
                .where(inArray(sessionTelemetry.id, ids));
            }
            telemetryDeleted = ids.length;
          },
        });

        if (isDryRun) {
          telemetryDeleted = result.deleted;
        }
      } catch (err) {
        console.error("Telemetry cleanup error:", err);
      }

      if (isDryRun) {
        console.log(`Would remove ${orphanCount} orphan worktree(s)`);
        console.log(`Would delete ${telemetryDeleted} old telemetry event(s)`);
      } else {
        console.log(`Removed ${orphanCount} orphan worktree(s)`);
        console.log(`Deleted ${telemetryDeleted} old telemetry event(s)`);
      }
    });
}
