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

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === "fulfilled") {
        stepResults.push(result.value);
      } else {
        stepResults.push({
          name: steps[i].name,
          passed: false,
          output: result.reason.message || String(result.reason),
          durationMs: 0,
        });
      }
    }

    // Use index-aligned lookup (not find-by-name) to check required steps
    const overallPassed = !stepResults.some(
      (_, i) => !stepResults[i].passed && steps[i].required,
    );
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
        break; // Short-circuit: no point running remaining steps
      }
    }

    return { passed: overallPassed, steps: stepResults };
  }
}
