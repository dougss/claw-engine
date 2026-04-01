import { describe, it, expect } from "vitest";
import {
  createPullRequest,
  createBranch,
} from "../../../src/integrations/github/client.js";

describe("GitHub client", () => {
  it("exports createPullRequest function", () => {
    expect(typeof createPullRequest).toBe("function");
    expect(typeof createBranch).toBe("function");
  });
});
