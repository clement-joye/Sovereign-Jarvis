import type { PostgresPoolConfig } from "@second-brain/postgres-adapter";

export type BrainControlStorageMode = "ephemeral" | "postgres";

export function resolveBrainControlStorageMode(input: {
  environment: string;
  postgresConnection: string | PostgresPoolConfig | undefined;
}): BrainControlStorageMode {
  if (input.postgresConnection) {
    return "postgres";
  }
  if (input.environment === "production") {
    throw new Error(
      "Brain Control requires DATABASE_URL or BRAIN_DATABASE_HOST in production; ephemeral storage is not permitted."
    );
  }
  return "ephemeral";
}
