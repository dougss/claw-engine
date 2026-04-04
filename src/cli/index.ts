#!/usr/bin/env node
import { loadDefaultEnvFiles } from "../env-loader.js";
loadDefaultEnvFiles();
import { Command } from "commander";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerRunCommand } from "./commands/run.js";
import { registerSubmitCommand } from "./commands/submit.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerSessionsCommand } from "./commands/sessions.js";
import { registerLogsCommand } from "./commands/logs.js";
import { registerCostsCommand } from "./commands/costs.js";
import { registerRouterStatsCommand } from "./commands/router-stats.js";
import { registerCleanupCommand } from "./commands/cleanup.js";
import { registerDaemonCommand } from "./commands/daemon.js";
import { registerPauseCommand } from "./commands/pause.js";
import { registerResumeCommand } from "./commands/resume.js";
import { registerCancelCommand } from "./commands/cancel.js";
import { registerRetryCommand } from "./commands/retry.js";
import { registerApproveCommand } from "./commands/approve.js";
import { registerChatCommand } from "./commands/chat.js";

const program = new Command()
  .name("claw")
  .description("Claw Engine — model-agnostic coding agent factory")
  .version("0.1.0");

registerRunCommand(program);
registerSubmitCommand(program);
registerStatusCommand(program);
registerSessionsCommand(program);
registerLogsCommand(program);
registerCostsCommand(program);
registerRouterStatsCommand(program);
registerCleanupCommand(program);
registerDaemonCommand(program);
registerDoctorCommand(program);
registerPauseCommand(program);
registerResumeCommand(program);
registerCancelCommand(program);
registerRetryCommand(program);
registerApproveCommand(program);
registerChatCommand(program);

// Default command logic:
// - No arguments at all → enter interactive chat
// - Unknown command → treat as prompt for one-shot run
const knownCommands = new Set(program.commands.map((c) => c.name()));
const [, , firstArg] = process.argv;

if (!firstArg) {
  // No arguments: enter interactive chat
  process.argv.splice(2, 0, "chat");
} else if (!firstArg.startsWith("-") && !knownCommands.has(firstArg)) {
  // Unknown command: treat as prompt for one-shot run
  process.argv.splice(2, 0, "run");
}

program.parse();
