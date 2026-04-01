interface AttemptLog {
  error: string;
  model: string;
}

const ERROR_CLASSES = {
  syntax: /syntax error|unexpected token|parsing error/i,
  type: /type error|cannot find name|is not assignable/i,
  import: /cannot find module|module not found/i,
  timeout: /timeout|timed out|ETIMEDOUT/i,
  rate_limit: /rate limit|429|too many requests/i,
  auth: /unauthorized|403|forbidden|invalid api key/i,
  network: /ECONNREFUSED|ECONNRESET|ENOTFOUND/i,
} as const;

export function classifyError(error: string): string {
  for (const [cls, pattern] of Object.entries(ERROR_CLASSES)) {
    if (pattern.test(error)) return cls;
  }
  return "unknown";
}

export function shouldEscalate(attempts: AttemptLog[]): boolean {
  if (attempts.length < 2) return true;
  const errorClasses = attempts.map((a) => classifyError(a.error));
  const uniqueClasses = new Set(errorClasses);
  return uniqueClasses.size > 1;
}
