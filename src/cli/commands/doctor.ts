import { execFile } from "node:child_process";
import { statfs } from "node:fs/promises";
import net from "node:net";
import { loadConfig } from "../../config.js";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface DoctorCheck {
  name: string;
  passed: boolean;
  message: string;
}

type CheckFn = () => Promise<DoctorCheck>;

export function createDefaultCheckers() {
  return {
    checkConfig: async (): Promise<DoctorCheck> => {
      try {
        loadConfig();
        return { name: "config", passed: true, message: "Config valid" };
      } catch (err) {
        return { name: "config", passed: false, message: String(err) };
      }
    },

    checkDb: async (): Promise<DoctorCheck> => {
      try {
        const config = loadConfig();
        const { host, port, database, user } = config.database;
        const pass =
          process.env[config.database.password_env] ?? "claw_engine_local";
        const connStr = `postgres://${user}:${pass}@${host}:${port}/${database}`;
        const { getDb, closeDb } = await import("../../storage/db.js");
        const db = getDb({ connectionString: connStr });
        await db.execute(
          "SELECT 1" as unknown as Parameters<typeof db.execute>[0],
        );
        await closeDb();
        return {
          name: "database",
          passed: true,
          message: `Connected to ${database}@${host}:${port}`,
        };
      } catch (err) {
        return { name: "database", passed: false, message: String(err) };
      }
    },

    checkRedis: async (): Promise<DoctorCheck> => {
      try {
        const config = loadConfig();
        const { host, port } = config.redis;
        await new Promise<void>((resolve, reject) => {
          const socket = net.createConnection({ host, port }, () => {
            socket.write("PING\r\n");
          });
          socket.on("data", (data) => {
            socket.destroy();
            if (data.toString().startsWith("+PONG")) {
              resolve();
            } else {
              reject(
                new Error(
                  `Unexpected Redis response: ${data.toString().trim()}`,
                ),
              );
            }
          });
          socket.on("error", reject);
          socket.setTimeout(3000, () => {
            socket.destroy();
            reject(new Error("Connection timeout"));
          });
        });
        return {
          name: "redis",
          passed: true,
          message: `Connected to ${host}:${port}`,
        };
      } catch (err) {
        return { name: "redis", passed: false, message: String(err) };
      }
    },

    checkClaude: async (): Promise<DoctorCheck> => {
      try {
        const config = loadConfig();
        const binary = config.providers.anthropic.binary;
        const { stdout } = await execFileAsync("which", [binary]);
        const path = stdout.trim();
        return {
          name: "claude binary",
          passed: true,
          message: `Found at ${path}`,
        };
      } catch {
        return {
          name: "claude binary",
          passed: false,
          message: "claude binary not found on PATH",
        };
      }
    },

    checkDisk: async (): Promise<DoctorCheck> => {
      try {
        const stats = await statfs("/");
        const freeGb = (stats.bavail * stats.bsize) / 1024 ** 3;
        const minGb = 20;
        return {
          name: "disk space",
          passed: freeGb >= minGb,
          message: `${freeGb.toFixed(1)} GB free (minimum ${minGb} GB)`,
        };
      } catch (err) {
        return { name: "disk space", passed: false, message: String(err) };
      }
    },
  };
}

export async function runDoctorChecks(checkers: {
  checkConfig: CheckFn;
  checkDb: CheckFn;
  checkRedis: CheckFn;
  checkClaude: CheckFn;
  checkDisk?: CheckFn;
}): Promise<DoctorCheck[]> {
  const checks = [
    checkers.checkConfig(),
    checkers.checkDb(),
    checkers.checkRedis(),
    checkers.checkClaude(),
  ];
  if (checkers.checkDisk) checks.push(checkers.checkDisk());
  return Promise.all(checks);
}

export function registerDoctorCommand(program: import("commander").Command) {
  program
    .command("doctor")
    .description("Run health checks: config, database, Redis, claude binary")
    .action(async () => {
      const checkers = createDefaultCheckers();
      const checks = await runDoctorChecks(checkers);
      for (const check of checks) {
        const icon = check.passed ? "✅" : "❌";
        console.log(`${icon} ${check.name}: ${check.message}`);
      }
      const allPassed = checks.every((c) => c.passed);
      if (!allPassed) process.exit(1);
    });
}
