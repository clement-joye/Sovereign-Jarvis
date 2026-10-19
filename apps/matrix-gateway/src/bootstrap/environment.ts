export function requiredEnv(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}
