export declare function validatePluginSource(
  root: string,
  manifest: any,
  providers?: readonly any[],
  retiredIdentifiers?: unknown
): Promise<boolean>;
export declare function validateRetiredIdentifierReservations(
  manifest: any,
  registry: unknown
): boolean;
export declare function generatePluginDocs(manifests: readonly any[]): string;
