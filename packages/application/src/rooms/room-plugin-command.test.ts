import { describe, expect, it, vi } from "vitest";

import { CompiledPluginV2Schema, exampleInboundMessage } from "@second-brain/contracts";

import { RoomPluginCommandSubmissionService } from "./room-plugin-command.js";
import type {
  OutboundRepositoryPort,
  WorkspacePluginBindingListingRepositoryPort
} from "../ports.js";

const manifest = CompiledPluginV2Schema.parse({
  id: "calendar-test",
  contentDigest: `sha256:${"a".repeat(64)}`,
  displayName: "Calendar test",
  activation: "workspace",
  operations: [
    { id: "calendar-list", toolName: "calendar_list", approvalPolicy: "none" },
    { id: "calendar-create", toolName: "calendar_create", approvalPolicy: "none" },
    { id: "calendar-delete", toolName: "calendar_delete", approvalPolicy: "owner" }
  ],
  agentIds: ["brain"],
  credentialKind: "oauth-token",
  configurationSchema: {
    calendar: "string",
    timezone: "string",
    "allow-write": "boolean"
  }
});
const builtInManifest = CompiledPluginV2Schema.parse({
  id: "core-agents",
  contentDigest: `sha256:${"b".repeat(64)}`,
  displayName: "Core agents",
  activation: "built-in",
  operations: [],
  agentIds: ["brain"],
  configurationSchema: {}
});

describe("RoomPluginCommandSubmissionService", () => {
  it("enables a calendar plugin for the message workspace using a non-secret credential reference", async () => {
    const bindings = bindingRepository();
    const create = vi.fn<OutboundRepositoryPort["create"]>(async (outbound) => outbound);
    const service = createService(bindings.repository, create);

    await service.submit(
      message(
        "/plugin enable calendar-test calendar=personal timezone=UTC allow-write=true credential=calendar-default"
      )
    );

    expect(bindings.upsert).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      pluginId: "calendar-test",
      pluginVersion: manifest.contentDigest,
      enabledAgents: ["brain"],
      credentialRef: "calendar-default",
      configuration: {
        calendar: "personal",
        timezone: "UTC",
        "allow-write": true
      },
      updatedAt: new Date("2026-09-08T15:00:00.000Z")
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace-1",
        text: expect.stringMatching(/^Enabled `calendar-test` for this workspace/u),
        presentation: "notice"
      })
    );
  });

  it("reports validation errors without persisting an unsafe binding", async () => {
    const bindings = bindingRepository();
    const create = vi.fn<OutboundRepositoryPort["create"]>(async (outbound) => outbound);
    const service = createService(bindings.repository, create);

    await service.submit(
      message(
        "/plugin enable calendar-test calendar=personal timezone=UTC allow-write=yes credential=calendar-default"
      )
    );

    expect(bindings.upsert).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("must be `true` or `false`"),
        presentation: "error"
      })
    );
  });

  it("keeps an unknown plugin error visible", async () => {
    const bindings = bindingRepository();
    const create = vi.fn<OutboundRepositoryPort["create"]>(async (outbound) => outbound);
    const service = createService(bindings.repository, create);

    await service.submit(message("/plugin status missing-plugin"));

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Unknown plugin: `missing-plugin`.",
        presentation: "error"
      })
    );
  });

  it("shows and disables only the current workspace binding", async () => {
    const bindings = bindingRepository({
      workspaceId: "workspace-1",
      pluginId: "calendar-test",
      pluginVersion: "1.0.0",
      enabledAgents: ["brain"],
      configuration: { calendar: "personal", timezone: "UTC" },
      credentialRef: "calendar-default"
    });
    const create = vi.fn<OutboundRepositoryPort["create"]>(async (outbound) => outbound);
    const service = createService(bindings.repository, create);

    await service.submit(message("/plugin status calendar-test"));
    await service.submit(message("/plugin disable calendar-test", "$event-2"));

    expect(bindings.get).toHaveBeenCalledWith("workspace-1", "calendar-test");
    expect(bindings.disable).toHaveBeenCalledWith("workspace-1", "calendar-test");
    expect(create.mock.calls[0]?.[0].text).toContain("Credential reference: `calendar-default`");
    expect(create.mock.calls[1]?.[0].text).toContain("Disabled `calendar-test` for this workspace");
  });

  it("lists all enabled plugins in the current workspace", async () => {
    const bindings = bindingRepository({
      workspaceId: "workspace-1",
      pluginId: "calendar-test",
      pluginVersion: "1.0.0",
      enabledAgents: ["brain"],
      configuration: { calendar: "personal", timezone: "UTC" }
    });
    const create = vi.fn<OutboundRepositoryPort["create"]>(async (outbound) => outbound);
    const service = createService(bindings.repository, create);

    await service.submit(message("/plugin status"));

    expect(bindings.list).toHaveBeenCalledWith("workspace-1");
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringMatching(
          /`core-agents` \(built-in\)[\s\S]*`calendar-test` \(workspace\)/
        )
      })
    );
  });
});

function createService(
  bindings: WorkspacePluginBindingListingRepositoryPort,
  create: OutboundRepositoryPort["create"]
) {
  return new RoomPluginCommandSubmissionService({
    bindings,
    outbounds: { create },
    ids: { nextId: () => "outbound-1" },
    clock: { now: () => new Date("2026-09-08T15:00:00.000Z") },
    catalog: {
      get: (pluginId) => (pluginId === manifest.id ? manifest : undefined),
      list: () => [builtInManifest, manifest]
    }
  });
}

function bindingRepository(
  current?: Awaited<ReturnType<WorkspacePluginBindingListingRepositoryPort["get"]>>
) {
  const upsert = vi.fn<WorkspacePluginBindingListingRepositoryPort["upsert"]>().mockResolvedValue();
  const get = vi
    .fn<WorkspacePluginBindingListingRepositoryPort["get"]>()
    .mockResolvedValue(current);
  const list = vi
    .fn<WorkspacePluginBindingListingRepositoryPort["list"]>()
    .mockResolvedValue(current ? [current] : []);
  const disable = vi
    .fn<WorkspacePluginBindingListingRepositoryPort["disable"]>()
    .mockResolvedValue(current !== undefined);
  return { repository: { upsert, get, list, disable }, upsert, get, list, disable };
}

function message(text: string, externalEventId = "$event-1") {
  return {
    ...exampleInboundMessage,
    id: `inbound-${externalEventId}`,
    workspaceId: "workspace-1",
    conversationId: "!room:example",
    externalEventId,
    text,
    kind: "command" as const
  };
}
