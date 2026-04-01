import { describe, expect, it } from "vitest";

import { TASK_STATUS } from "../../../src/types.js";
import {
  isValidTransition,
  transition,
} from "../../../src/core/state-machine.js";

describe("state-machine", () => {
  it("accepts required valid transitions", () => {
    expect(
      isValidTransition(TASK_STATUS.pending, TASK_STATUS.provisioning),
    ).toBe(true);

    expect(
      isValidTransition(TASK_STATUS.running, TASK_STATUS.checkpointing),
    ).toBe(true);

    expect(isValidTransition(TASK_STATUS.running, TASK_STATUS.validating)).toBe(
      true,
    );

    expect(
      isValidTransition(TASK_STATUS.validating, TASK_STATUS.completed),
    ).toBe(true);

    expect(isValidTransition(TASK_STATUS.validating, TASK_STATUS.running)).toBe(
      true,
    );

    expect(isValidTransition(TASK_STATUS.running, TASK_STATUS.stalled)).toBe(
      true,
    );

    expect(isValidTransition(TASK_STATUS.stalled, TASK_STATUS.starting)).toBe(
      true,
    );
  });

  it("rejects required invalid transitions", () => {
    expect(isValidTransition(TASK_STATUS.completed, TASK_STATUS.running)).toBe(
      false,
    );
  });

  it("throws on invalid transition()", () => {
    expect(() =>
      transition(TASK_STATUS.completed, TASK_STATUS.running),
    ).toThrowError(/Invalid transition/);
  });

  it("returns destination on valid transition()", () => {
    expect(transition(TASK_STATUS.pending, TASK_STATUS.provisioning)).toBe(
      TASK_STATUS.provisioning,
    );
  });
});
