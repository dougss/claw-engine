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
}: {
  workspacePath: string;
  steps: ValidationStep[];
  execCommand: ExecCommandFn;
}): Promise<ValidationResult> {
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
