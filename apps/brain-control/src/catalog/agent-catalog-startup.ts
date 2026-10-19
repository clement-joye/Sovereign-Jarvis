const TRANSIENT_DATABASE_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ETIMEDOUT",
  "57P01",
  "57P02",
  "57P03"
]);

interface StartupRetryOptions {
  maxAttempts?: number;
  retryDelayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
}

export async function assertAgentCatalogCompatibleAtStartup(
  assertCompatible: () => Promise<void>,
  options: StartupRetryOptions = {}
): Promise<void> {
  const maxAttempts = options.maxAttempts ?? 30;
  const retryDelayMs = options.retryDelayMs ?? 1_000;
  const sleep = options.sleep ?? delay;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await assertCompatible();
      return;
    } catch (error) {
      if (attempt === maxAttempts || !isTransientDatabaseStartupError(error)) throw error;
      await sleep(retryDelayMs);
    }
  }
}

function isTransientDatabaseStartupError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  return TRANSIENT_DATABASE_ERROR_CODES.has(String(error.code));
}

function delay(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
