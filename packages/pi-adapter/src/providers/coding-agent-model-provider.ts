import type { PiRunResultV1 } from "@second-brain/contracts";

import type { PiModelProvider, PiModelRunInput } from "./model-provider.js";
import { PiSessionFactory, type PiSessionFactoryOptions } from "../sessions/pi-session-factory.js";
import { PiRunExecutor } from "../executions/pi-run-executor.js";

export { PiRunBudgetMeter, RunBudgetExceeded } from "../executions/pi-run-budget.js";
export {
  loadRoleExtensionFactories,
  resolvePiRoleResources
} from "../executions/pi-role-resources.js";
export {
  activePiToolNames,
  modelSelectionForAgent,
  piSessionDirectory
} from "../executions/pi-runtime-utils.js";

export type PiCodingAgentModelProviderOptions = PiSessionFactoryOptions;

/**
 * Runs the Pi coding-agent SDK with a model declared in its models.json file.
 * Each Second Brain session receives its own persisted Pi session directory.
 */
export class PiCodingAgentModelProvider implements PiModelProvider {
  private readonly sessionFactory: PiSessionFactory;
  private readonly executor: PiRunExecutor;

  constructor(options: PiCodingAgentModelProviderOptions) {
    this.sessionFactory = new PiSessionFactory(options);
    this.executor = new PiRunExecutor(options);
  }

  async run(input: PiModelRunInput): Promise<PiRunResultV1> {
    const startedAt = new Date().toISOString();
    const scheduleToolEvents: string[] = [];
    try {
      const created = await this.sessionFactory.create(input, scheduleToolEvents);
      return this.executor.execute(input, created, startedAt, scheduleToolEvents);
    } catch (error) {
      return this.executor.failure(input.request, startedAt, error, scheduleToolEvents);
    }
  }
}
