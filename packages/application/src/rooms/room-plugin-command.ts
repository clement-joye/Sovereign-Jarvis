import type {
  CompiledPluginV2,
  InboundMessageV1,
  OutboundMessageV1
} from "@second-brain/contracts";
import type { ClockPort, IdGeneratorPort, RoomAgentId } from "@second-brain/domain";

import type {
  OutboundRepositoryPort,
  WorkspacePluginBindingListingRepositoryPort
} from "../ports.js";
import { parsePluginConfiguration } from "../policy/plugin-configuration.js";

type PluginCommand =
  | { type: "enable"; pluginId: string; options: Readonly<Record<string, string>> }
  | { type: "status"; pluginId: string }
  | { type: "status-all" }
  | { type: "disable"; pluginId: string }
  | { type: "invalid"; text: string }
  | { type: "none" };

export interface RoomPluginCatalog {
  get(pluginId: string): CompiledPluginV2 | undefined;
  list(): CompiledPluginV2[];
}

export interface RoomPluginCommandSubmissionOptions {
  bindings: WorkspacePluginBindingListingRepositoryPort;
  outbounds: Pick<OutboundRepositoryPort, "create">;
  ids: IdGeneratorPort;
  clock: ClockPort;
  catalog: RoomPluginCatalog;
}

/** Applies trusted owner plugin commands to the workspace derived from the Matrix room. */
export class RoomPluginCommandSubmissionService {
  private readonly bindings: WorkspacePluginBindingListingRepositoryPort;
  private readonly outbounds: Pick<OutboundRepositoryPort, "create">;
  private readonly ids: IdGeneratorPort;
  private readonly clock: ClockPort;
  private readonly catalog: RoomPluginCatalog;

  constructor(options: RoomPluginCommandSubmissionOptions) {
    this.bindings = options.bindings;
    this.outbounds = options.outbounds;
    this.ids = options.ids;
    this.clock = options.clock;
    this.catalog = options.catalog;
  }

  async submit(
    message: InboundMessageV1
  ): Promise<{ handled: boolean; outbound?: OutboundMessageV1 }> {
    if (!message.workspaceId || !message.text) return { handled: false };
    const command = parsePluginCommand(message.text);
    if (command.type === "none") return { handled: false };

    const result =
      command.type === "invalid"
        ? { text: command.text, presentation: "error" as const }
        : await this.execute(message.workspaceId, command);
    const threadRootExternalEventId = message.threadRootExternalEventId ?? message.externalEventId;
    const outbound = await this.outbounds.create({
      schemaVersion: 1,
      id: this.ids.nextId("outbound"),
      traceId: message.traceId,
      workspaceId: message.workspaceId,
      conversationId: message.conversationId,
      text: result.text,
      images: [],
      replyToExternalEventId: message.externalEventId,
      threadRootExternalEventId,
      presentation: result.presentation,
      urgency: "normal",
      idempotencyKey: `${message.workspaceId}:${message.externalEventId}:plugin-command`
    });
    return { handled: true, outbound };
  }

  private async execute(
    workspaceId: string,
    command: Exclude<PluginCommand, { type: "invalid" | "none" }>
  ): Promise<{ text: string; presentation: "notice" | "error" }> {
    if (command.type === "status-all") {
      return { text: await this.formatEnabledPlugins(workspaceId), presentation: "notice" };
    }
    const manifest = this.catalog.get(command.pluginId);
    if (!manifest) {
      return { text: `Unknown plugin: \`${command.pluginId}\`.`, presentation: "error" };
    }
    if (manifest.activation === "built-in") {
      return {
        text: `\`${command.pluginId}\` is built in and cannot be managed per workspace.`,
        presentation: "error"
      };
    }
    if (command.type === "status") {
      return {
        text: formatPluginStatus(
          command.pluginId,
          await this.bindings.get(workspaceId, command.pluginId)
        ),
        presentation: "notice"
      };
    }
    if (command.type === "disable") {
      const disabled = await this.bindings.disable(workspaceId, command.pluginId);
      return {
        text: disabled
          ? `Disabled \`${command.pluginId}\` for this workspace.`
          : `\`${command.pluginId}\` is already disabled.`,
        presentation: "notice"
      };
    }

    const parsed = parsePluginConfiguration(manifest, command.options);
    if ("error" in parsed) return { text: parsed.error, presentation: "error" };
    await this.bindings.upsert({
      workspaceId,
      pluginId: manifest.id,
      pluginVersion: manifest.contentDigest,
      enabledAgents: [...manifest.agentIds] as RoomAgentId[],
      configuration: parsed.configuration,
      ...(parsed.credentialRef ? { credentialRef: parsed.credentialRef } : {}),
      updatedAt: this.clock.now()
    });
    return {
      text: [
        `Enabled \`${manifest.id}\` for this workspace (agents: ${manifest.agentIds.map((agentId) => `\`${agentId}\``).join(", ")}).`,
        `Review with \`/plugin status ${manifest.id}\`.`
      ].join("\n"),
      presentation: "notice"
    };
  }

  private async formatEnabledPlugins(workspaceId: string): Promise<string> {
    const bindings = new Map(
      (await this.bindings.list(workspaceId)).map((binding) => [binding.pluginId, binding])
    );
    const enabled = this.catalog
      .list()
      .filter((manifest) => manifest.activation === "built-in" || bindings.has(manifest.id));
    if (enabled.length === 0) return "No plugins enabled.";
    return [
      "**Enabled plugins**",
      "",
      ...enabled.map((manifest) => {
        const activation = manifest.activation === "built-in" ? "built-in" : "workspace";
        return `• \`${manifest.id}\` (${activation}) — agents: ${manifest.agentIds
          .map((agentId) => `\`${agentId}\``)
          .join(", ")}`;
      })
    ].join("\n");
  }
}

function parsePluginCommand(text: string): PluginCommand {
  const parts = text.trim().split(/\s+/);
  if (parts[0] !== "/plugin") return { type: "none" };
  const action = parts[1];
  const pluginId = parts[2];
  if (isAggregateStatus(parts)) return { type: "status-all" };
  if (!pluginId || !/^[a-z][a-z0-9-]{0,63}$/.test(pluginId)) return invalidPluginCommand();
  if ((action === "status" || action === "disable") && parts.length === 3) {
    return { type: action, pluginId };
  }
  if (action !== "enable" || parts.length < 3) return invalidPluginCommand();

  const options: Record<string, string> = {};
  for (const token of parts.slice(3)) {
    const separator = token.indexOf("=");
    const key = token.slice(0, separator);
    const value = token.slice(separator + 1);
    if (
      separator <= 0 ||
      !/^[a-z][a-z0-9-]{0,63}$/.test(key) ||
      !value ||
      Object.hasOwn(options, key)
    ) {
      return invalidPluginCommand();
    }
    options[key] = value;
  }
  return { type: "enable", pluginId, options };
}

function isAggregateStatus(parts: string[]): boolean {
  return parts[1] === "status" && parts.length === 2;
}

function formatPluginStatus(
  pluginId: string,
  binding: Awaited<ReturnType<WorkspacePluginBindingListingRepositoryPort["get"]>>
): string {
  if (!binding) return `\`${pluginId}\` is disabled.`;
  const configuration = Object.entries(binding.configuration)
    .map(([key, value]) => `• \`${key}\`: \`${String(value)}\``)
    .join("\n");
  return [
    `**Plugin \`${pluginId}\`**`,
    "",
    "Enabled",
    `Agents: ${binding.enabledAgents.map((agentId) => `\`${agentId}\``).join(", ")}`,
    ...(configuration ? ["Configuration:", configuration] : []),
    ...(binding.credentialRef ? [`Credential reference: \`${binding.credentialRef}\``] : [])
  ].join("\n");
}

function invalidPluginCommand(): PluginCommand {
  return {
    type: "invalid",
    text: [
      "Use one of:",
      "• `/plugin status`",
      "• `/plugin enable <plugin-id> key=value ... credential=<reference>`",
      "• `/plugin status <plugin-id>`",
      "• `/plugin disable <plugin-id>`"
    ].join("\n")
  };
}
