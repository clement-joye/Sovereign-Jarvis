export interface DatabaseMigrationOptions {
  help?: boolean;
  envFile?: string;
  composeFile?: string;
  projectName?: string;
}

export function parseOptions(args: readonly string[]): DatabaseMigrationOptions;
export function orderedMigrationFiles(entries: readonly string[]): string[];
export function pendingMigrationFiles(files: readonly string[], currentMigration: number): string[];
export function resolveCurrentMigration(options: {
  hasApplicationSchema: boolean;
  hasMigrationLedger: boolean;
  migrationNumber: string;
  latestMigration: number;
}): number;
