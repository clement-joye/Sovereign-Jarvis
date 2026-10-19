import { describe, expect, it } from "vitest";

import { canTransitionWorkspace, transitionWorkspace, type WorkspaceRecord } from "./workspace.js";

const workspace: WorkspaceRecord = {
  id: "workspace-1",
  templateId: "second-brain",
  templateVersion: "1.0.0",
  configuration: {},
  status: "pending_invite",
  origin: "legacy_seed",
  createdAt: new Date("2026-08-03T10:00:00.000Z"),
  updatedAt: new Date("2026-08-03T10:00:00.000Z")
};

describe("workspace lifecycle", () => {
  it("allows the normal invitation-to-active lifecycle", () => {
    expect(canTransitionWorkspace("pending_invite", "configuring")).toBe(true);
    expect(canTransitionWorkspace("configuring", "provisioning")).toBe(true);
    expect(canTransitionWorkspace("provisioning", "active")).toBe(true);

    const configured = transitionWorkspace(
      workspace,
      "configuring",
      new Date("2026-08-03T10:01:00.000Z")
    );
    const provisioning = transitionWorkspace(
      configured,
      "provisioning",
      new Date("2026-08-03T10:02:00.000Z")
    );
    const active = transitionWorkspace(
      provisioning,
      "active",
      new Date("2026-08-03T10:03:00.000Z")
    );

    expect(active).toMatchObject({
      status: "active",
      activatedAt: new Date("2026-08-03T10:03:00.000Z")
    });
  });

  it("allows archival and reprovisioning without treating a workspace as deleted", () => {
    const archived = transitionWorkspace(
      { ...workspace, status: "active" },
      "archived",
      new Date("2026-08-03T11:00:00.000Z")
    );

    expect(archived.archivedAt).toEqual(new Date("2026-08-03T11:00:00.000Z"));
    expect(canTransitionWorkspace("archived", "provisioning")).toBe(true);
    expect(canTransitionWorkspace("archived", "closed")).toBe(true);
  });

  it("rejects lifecycle shortcuts and terminal workspace changes", () => {
    expect(canTransitionWorkspace("pending_invite", "active")).toBe(false);
    expect(canTransitionWorkspace("active", "configuring")).toBe(false);
    expect(canTransitionWorkspace("closed", "active")).toBe(false);
    expect(() =>
      transitionWorkspace(workspace, "active", new Date("2026-08-03T10:01:00.000Z"))
    ).toThrow("Cannot transition workspace from pending_invite to active.");
  });
});
