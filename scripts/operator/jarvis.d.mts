// Hand-authored TypeScript contract for the operator script's test consumers.
import type { Buffer } from "node:buffer";

export interface OperatorOptions {
  command?: string;
  positional?: string[];
  stateRoot?: string;
  tail?: string;
  follow?: boolean;
  yes?: boolean;
  confirminterruption?: boolean;
  help?: boolean;
}

export interface OperatorRunOptions {
  capture?: boolean;
  stdio?: "inherit" | "ignore" | "pipe";
  outputFile?: string;
  inputFile?: string;
  input?: string;
}

export interface OperatorDependencies {
  composeArgs?: string[];
  composeFile?: string;
  projectName?: string;
  run?: (command: string, args: string[], options?: OperatorRunOptions) => Buffer;
  output?: (text: string) => void;
  confirm?: (message: string) => Promise<boolean>;
}

export function parseArgs(args: string[]): OperatorOptions;
export function runOperator(
  options: OperatorOptions,
  dependencies?: OperatorDependencies
): Promise<number>;
