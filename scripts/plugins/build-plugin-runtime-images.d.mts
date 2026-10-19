export const runtimeBuildInputLabel: string;

export function pluginRuntimeBuildInput(options: {
  pluginRoot: string;
  root?: string;
  dockerfile: string;
  image: Record<string, unknown>;
  baseRuntimeImageId?: string;
}): string;
