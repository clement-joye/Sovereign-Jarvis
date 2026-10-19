import type { PostgresPoolConfig } from "@second-brain/postgres-adapter";

export function postgresConnectionConfig(
  env: NodeJS.ProcessEnv
): string | PostgresPoolConfig | undefined {
  if (env.DATABASE_URL) {
    return env.DATABASE_URL;
  }
  if (!env.BRAIN_DATABASE_HOST) {
    return undefined;
  }
  if (!env.BRAIN_DATABASE_PASSWORD) {
    throw new Error("BRAIN_DATABASE_PASSWORD is required when BRAIN_DATABASE_HOST is configured.");
  }
  return {
    host: env.BRAIN_DATABASE_HOST,
    port: Number(env.BRAIN_DATABASE_PORT ?? "5432"),
    database: env.BRAIN_DATABASE_NAME ?? "brain",
    user: env.BRAIN_DATABASE_USER ?? "brain",
    password: env.BRAIN_DATABASE_PASSWORD
  };
}
