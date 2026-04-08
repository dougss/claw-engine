import type { StepResult } from "./validation-runner.js";

export function compressValidationErrors(
  steps: StepResult[],
  maxChars: number = 2000
): string {
  const failedSteps = steps.filter((step) => !step.passed);
  
  if (failedSteps.length === 0) {
    return "";
  }
  
  const compressedOutputs: string[] = [];
  
  for (const step of failedSteps) {
    const lines = step.output.split('\n');
    
    let processedOutput: string;
    if (lines.length > 10) {
      // Keep first 5 and last 5 lines, with omission indicator
      const firstFive = lines.slice(0, 5);
      const lastFive = lines.slice(-5);
      processedOutput = [
        ...firstFive,
        `... (${lines.length - 10} lines omitted) ...`,
        ...lastFive
      ].join('\n');
    } else {
      // Keep all lines if 10 or fewer
      processedOutput = step.output;
    }
    
    compressedOutputs.push(`${step.name}:\n${processedOutput}`);
  }
  
  let result = compressedOutputs.join('\n\n');
  
  // Truncate if exceeding maxChars
  if (result.length > maxChars) {
    result = result.substring(0, maxChars) + '\n... (truncated)';
  }
  
  return result;
}