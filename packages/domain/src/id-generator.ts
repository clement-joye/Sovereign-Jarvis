export interface IdGeneratorPort {
  nextId(prefix: string): string;
}
