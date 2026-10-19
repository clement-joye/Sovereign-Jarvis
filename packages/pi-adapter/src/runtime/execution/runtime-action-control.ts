export interface RuntimeActionControl {
  execute(operationId: string, parameters: Record<string, unknown>): Promise<unknown>;
}

const controlKey = Symbol.for("jarvis.runtime-action-control");

type RuntimeControlGlobal = typeof globalThis & {
  [controlKey]?: RuntimeActionControl;
};

/** Registers a plugin extension's process-local bridge for approved runtime actions. */
export function registerRuntimeActionControl(control: RuntimeActionControl): void {
  (globalThis as RuntimeControlGlobal)[controlKey] = control;
}

/** Invokes only the already-loaded plugin extension in this isolated runtime. */
export async function executeRuntimeAction(
  operationId: string,
  parameters: Record<string, unknown>
): Promise<unknown> {
  if (!/^[a-z][a-z0-9-]{0,63}$/u.test(operationId)) throw new Error("Invalid runtime action.");
  const control = (globalThis as RuntimeControlGlobal)[controlKey];
  if (!control) throw new Error("Plugin action control is unavailable in this runtime.");
  return control.execute(operationId, parameters);
}
