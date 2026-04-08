import { describe, it, expect } from "vitest";
import { compressValidationErrors } from "../../src/core/context-compressor.js";
import type { StepResult } from "../../src/core/validation-runner.js";

describe("compressValidationErrors", () => {
  it("returns empty string when no failed steps", () => {
    const steps: StepResult[] = [
      { name: "test1", passed: true, output: "output1", durationMs: 100 },
      { name: "test2", passed: true, output: "output2", durationMs: 200 },
    ];
    
    const result = compressValidationErrors(steps);
    expect(result).toBe("");
  });

  it("keeps all lines when output has 10 or fewer lines", () => {
    const steps: StepResult[] = [
      { 
        name: "failing-test", 
        passed: false, 
        output: "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10", 
        durationMs: 100 
      },
    ];
    
    const result = compressValidationErrors(steps);
    expect(result).toContain("line1");
    expect(result).toContain("line10");
    expect(result).not.toContain("omitted");
  });

  it("compresses long output to first 5 and last 5 lines", () => {
    const longOutput = Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join('\n');
    const steps: StepResult[] = [
      { 
        name: "failing-test", 
        passed: false, 
        output: longOutput, 
        durationMs: 100 
      },
    ];
    
    const result = compressValidationErrors(steps);
    expect(result).toContain("line1");
    expect(result).toContain("line2");
    expect(result).toContain("line3");
    expect(result).toContain("line4");
    expect(result).toContain("line5");
    expect(result).toContain("line16");
    expect(result).toContain("line17");
    expect(result).toContain("line18");
    expect(result).toContain("line19");
    expect(result).toContain("line20");
    expect(result).toContain("... (10 lines omitted) ...");
  });

  it("handles multiple failed steps correctly", () => {
    const steps: StepResult[] = [
      { 
        name: "failing-test-1", 
        passed: false, 
        output: Array.from({ length: 15 }, (_, i) => `step1-line${i + 1}`).join('\n'), 
        durationMs: 100 
      },
      { 
        name: "failing-test-2", 
        passed: false, 
        output: Array.from({ length: 12 }, (_, i) => `step2-line${i + 1}`).join('\n'), 
        durationMs: 200 
      },
    ];
    
    const result = compressValidationErrors(steps);
    expect(result).toContain("failing-test-1:");
    expect(result).toContain("failing-test-2:");
    expect(result).toContain("step1-line1");
    expect(result).toContain("step1-line15");
    expect(result).toContain("step2-line1");
    expect(result).toContain("step2-line12");
    expect(result).toContain("... (5 lines omitted) ...");
    expect(result).toContain("... (2 lines omitted) ...");
  });

  it("truncates output when exceeding max character limit", () => {
    const longLine = "A".repeat(1000); // 1000 chars per line
    const steps: StepResult[] = [
      { 
        name: "huge-output", 
        passed: false, 
        output: Array.from({ length: 10 }, () => longLine).join('\n'), 
        durationMs: 100 
      },
    ];
    
    const result = compressValidationErrors(steps, 2000); // Max 2000 chars
    expect(result.length).toBeLessThanOrEqual(2020); // Allow for " (truncated)" addition
    expect(result).toContain("(truncated)");
  });

  it("ignores passed steps", () => {
    const steps: StepResult[] = [
      { 
        name: "passing-test", 
        passed: true, 
        output: Array.from({ length: 20 }, (_, i) => `pass${i + 1}`).join('\n'), 
        durationMs: 100 
      },
      { 
        name: "failing-test", 
        passed: false, 
        output: Array.from({ length: 15 }, (_, i) => `fail${i + 1}`).join('\n'), 
        durationMs: 200 
      },
    ];
    
    const result = compressValidationErrors(steps);
    expect(result).not.toContain("passing-test");
    expect(result).toContain("failing-test:");
    expect(result).not.toContain("pass1");
  });
});