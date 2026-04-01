import { TASK_STATUS, type TaskStatus } from "../types.js";

const TRANSITIONS: Readonly<Record<TaskStatus, ReadonlySet<TaskStatus>>> = {
  [TASK_STATUS.pending]: new Set([TASK_STATUS.provisioning]),
  [TASK_STATUS.merging_dependency]: new Set([TASK_STATUS.provisioning]),
  [TASK_STATUS.provisioning]: new Set([
    TASK_STATUS.starting,
    TASK_STATUS.failed,
  ]),
  [TASK_STATUS.starting]: new Set([
    TASK_STATUS.running,
    TASK_STATUS.stalled,
    TASK_STATUS.failed,
  ]),
  [TASK_STATUS.running]: new Set([
    TASK_STATUS.checkpointing,
    TASK_STATUS.validating,
    TASK_STATUS.stalled,
    TASK_STATUS.failed,
    TASK_STATUS.interrupted,
    TASK_STATUS.needs_human_review,
    TASK_STATUS.cancelled,
  ]),
  [TASK_STATUS.checkpointing]: new Set([
    TASK_STATUS.running,
    TASK_STATUS.validating,
    TASK_STATUS.failed,
  ]),
  [TASK_STATUS.resuming]: new Set([TASK_STATUS.running, TASK_STATUS.failed]),
  [TASK_STATUS.validating]: new Set([
    TASK_STATUS.completed,
    TASK_STATUS.running,
    TASK_STATUS.failed,
    TASK_STATUS.needs_human_review,
  ]),
  [TASK_STATUS.completed]: new Set([]),
  [TASK_STATUS.stalled]: new Set([TASK_STATUS.starting, TASK_STATUS.failed]),
  [TASK_STATUS.failed]: new Set([TASK_STATUS.starting, TASK_STATUS.cancelled]),
  [TASK_STATUS.needs_human_review]: new Set([
    TASK_STATUS.starting,
    TASK_STATUS.running,
    TASK_STATUS.cancelled,
    TASK_STATUS.failed,
  ]),
  [TASK_STATUS.interrupted]: new Set([
    TASK_STATUS.resuming,
    TASK_STATUS.cancelled,
  ]),
  [TASK_STATUS.blocked]: new Set([TASK_STATUS.starting, TASK_STATUS.cancelled]),
  [TASK_STATUS.skipped]: new Set([TASK_STATUS.completed]),
  [TASK_STATUS.cancelled]: new Set([]),
} as const;

export function isValidTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TRANSITIONS[from]?.has(to) ?? false;
}

export function transition(from: TaskStatus, to: TaskStatus): TaskStatus {
  if (!isValidTransition(from, to)) {
    throw new Error(`Invalid transition: ${from} -> ${to}`);
  }

  return to;
}
