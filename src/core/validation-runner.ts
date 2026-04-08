export interface ValidationStep {
  name: string;
  command: string;
  required: boolean;
  retryable: boolean;
}

export interface StepResult {
  name: string;
  passed: boolean;
  output: string;
  durationMs: number;
}

export interface ValidationResult {
  passed: boolean;
  steps: StepResult[];
}

export type ExecCommandFn = (
  command: string,
  cwd: string,
) => Promise<{ stdout: string; exitCode: number }>;

export async function runValidation({
  workspacePath,
  steps,
  execCommand,
  parallel = false,
}: {
  workspacePath: string;
  steps: ValidationStep[];
  execCommand: ExecCommandFn;
  parallel?: boolean;
}): Promise<ValidationResult> {
  if (parallel) {
    const promises = steps.map(async (step) => {
      const start = Date.now();
      try {
        const { stdout, exitCode } = await execCommand(step.command, workspacePath);
        const durationMs = Date.now() - start;
        const passed = exitCode === 0;
        return { name: step.name, passed, output: stdout, durationMs };
      } catch (error) {
        const durationMs = Date.now() - start;
        return { name: step.name, passed: false, output: String(error), durationMs };
      }
    });

    const results = await Promise.allSettled(promises);
    const stepResults: StepResult[] = [];

    // Map each settled result to its corresponding step name
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const stepName = steps[i].name;
      
      if (result.status === "fulfilled") {
        stepResults.push(result.value);
      } else {
        // Handle rejected promises (shouldn't happen with the try/catch above, but just to be safe)
        stepResults.push({ name: stepName, passed: false, output: result.reason.message || String(result.reason), durationMs: 0 });
      }
    }

    const overallPassed = !stepResults.some(result => !result.passed && steps.find(s => s.name === result.name)?.required);
    return { passed: overallPassed, steps: stepResults };
  } else {
    const stepResults: StepResult[] = [];
    let overallPassed = true;

    for (const step of steps) {
      const start = Date.now();
      const { stdout, exitCode } = await execCommand(step.command, workspacePath);
      const durationMs = Date.now() - start;
      const passed = exitCode === 0;

      stepResults.push({ name: step.name, passed, output: stdout, durationMs });

      if (!passed && step.required) {
        overallPassed = false;
      }
    }

    return { passed: overallPassed, steps: stepResults };
  }
}
