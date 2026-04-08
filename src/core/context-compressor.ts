import type { StepResult } from "./validation-runner.js";

// Patterns that may contain secrets in validation output
const SECRET_PATTERNS = [
  /(?:api[_-]?key|token|secret|password|credential|auth)\s*[:=]\s*\S+/gi,
  /(?:Bearer|Basic)\s+[A-Za-z0-9+/=._-]{20,}/g,
];

function redactSecrets(text: string): string {
  let result = text;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}

export function compressValidationErrors(
  steps: StepResult[],
  maxChars: number = 2000,
): string {
  const failedSteps = steps.filter((step) => !step.passed);

  if (failedSteps.length === 0) {
    return "";
  }

  const compressedOutputs: string[] = [];

  for (const step of failedSteps) {
    if (!step.output || step.output.trim() === "") {
      compressedOutputs.push(`${step.name}: (no output)`);
      continue;
    }

    const lines = step.output.split("\n");
    let processedOutput: string;

    if (lines.length > 10) {
      const firstFive = lines.slice(0, 5);
      const lastFive = lines.slice(-5);
      processedOutput = [
        ...firstFive,
        `... (${lines.length - 10} lines omitted) ...`,
        ...lastFive,
      ].join("\n");
    } else {
      processedOutput = step.output;
    }

    compressedOutputs.push(`${step.name}:\n${redactSecrets(processedOutput)}`);
  }

  let result = compressedOutputs.join("\n\n");

  if (result.length > maxChars) {
    result = result.substring(0, maxChars) + "\n... (truncated)";
  }

  return result;
}
