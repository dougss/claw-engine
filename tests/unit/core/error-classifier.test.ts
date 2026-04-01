import { describe, it, expect } from "vitest";
import {
  classifyError,
  shouldEscalate,
} from "../../../src/core/error-classifier.js";

describe("classifyError", () => {
  it("classifies syntax errors", () => {
    expect(classifyError("syntax error on line 5")).toBe("syntax");
  });

  it("classifies import errors", () => {
    expect(classifyError("Cannot find module './foo'")).toBe("import");
  });

  it("classifies rate limit errors", () => {
    expect(classifyError("rate limit exceeded 429")).toBe("rate_limit");
  });

  it("classifies unknown errors", () => {
    expect(classifyError("some random error")).toBe("unknown");
  });
});

describe("shouldEscalate", () => {
  it("returns false when all attempts have same error class", () => {
    const attempts = [
      { error: "syntax error on line 1", model: "q" },
      { error: "syntax error on line 2", model: "c" },
    ];
    expect(shouldEscalate(attempts)).toBe(false);
  });

  it("returns true when attempts have different error classes", () => {
    const attempts = [
      { error: "syntax error", model: "q" },
      { error: "timeout", model: "c" },
    ];
    expect(shouldEscalate(attempts)).toBe(true);
  });

  it("returns true when only 1 attempt", () => {
    const attempts = [{ error: "anything", model: "q" }];
    expect(shouldEscalate(attempts)).toBe(true);
  });
});
