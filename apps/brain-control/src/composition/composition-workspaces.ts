import {
  RoomAgentCommandSubmissionService,
  RoomAgentCommandResponder,
  RoomLifecycleCommandSubmissionService,
  RoomPluginCommandSubmissionService,
  WorkspaceInvitationService,
  WorkspaceLifecycleRoomResolutionService,
  WorkspaceResolutionService,
  WorkspaceRoomLifecycleService,
  WorkspaceRoomRuntimeRecoveryService,
  WorkspaceRuntimeLifecycleService,
  type OutboundRepositoryPort,
  type RoomPluginCatalog,
  type ScheduleRepositoryPort,
  type WorkspacePluginBindingListingRepositoryPort,
  type WorkspaceRepositoryPort
} from "@second-brain/application";
import { loadRuntimeProvisionerClientConfig } from "@second-brain/configuration";
import type { AgentCatalog, ClockPort, IdGeneratorPort } from "@second-brain/domain";
import {
  HttpRuntimeProvisionerClient,
  ProvisionerWorkspaceRuntime
} from "@second-brain/pi-adapter";

export interface WorkspaceCompositionOptions {
  env: NodeJS.ProcessEnv;
  workspaces: WorkspaceRepositoryPort;
  schedules: ScheduleRepositoryPort;
  outbounds: Pick<OutboundRepositoryPort, "create">;
  pluginBindings: WorkspacePluginBindingListingRepositoryPort;
  ids: IdGeneratorPort;
  clock: ClockPort;
  agentCatalog: AgentCatalog;
  pluginCatalog: RoomPluginCatalog;
}

/** Composes workspace ownership, runtime lifecycle, and trusted room commands. */
export function createWorkspaceComposition(options: WorkspaceCompositionOptions) {
  const runtimeProvisioner = loadRuntimeProvisionerClientConfig(options.env);
  const workspaceRuntime = runtimeProvisioner
    ? new ProvisionerWorkspaceRuntime(
        new HttpRuntimeProvisionerClient(runtimeProvisioner.baseUrl, runtimeProvisioner.token)
      )
    : undefined;
  const workspaceRuntimeLifecycle = workspaceRuntime
    ? new WorkspaceRuntimeLifecycleService(options.workspaces, workspaceRuntime, options.clock)
    : undefined;
  return {
    runtimeProvisioner,
    workspaceResolution: new WorkspaceResolutionService(options.workspaces),
    workspaceLifecycleResolution: new WorkspaceLifecycleRoomResolutionService(options.workspaces),
    workspaceRoomLifecycle: new WorkspaceRoomLifecycleService(
      options.workspaces,
      options.clock,
      workspaceRuntime,
      options.schedules
    ),
    workspaceRoomRuntimeRecovery: workspaceRuntimeLifecycle
      ? new WorkspaceRoomRuntimeRecoveryService(options.workspaces, workspaceRuntimeLifecycle)
      : undefined,
    workspaceInvitation: new WorkspaceInvitationService(
      options.workspaces,
      options.ids,
      options.clock,
      options.agentCatalog
    ),
    roomLifecycleCommands: new RoomLifecycleCommandSubmissionService({
      workspaces: options.workspaces,
      outbounds: options.outbounds,
      ids: options.ids,
      clock: options.clock,
      runtime: workspaceRuntime,
      schedules: options.schedules
    }),
    roomAgentCommands: new RoomAgentCommandSubmissionService(
      options.workspaces,
      new RoomAgentCommandResponder(options.outbounds, options.ids),
      () => options.clock.now(),
      options.agentCatalog
    ),
    roomPluginCommands: new RoomPluginCommandSubmissionService({
      bindings: options.pluginBindings,
      outbounds: options.outbounds,
      ids: options.ids,
      clock: options.clock,
      catalog: options.pluginCatalog
    })
  };
}
