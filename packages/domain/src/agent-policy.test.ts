import { describe, expect, it } from "vitest";

import { INITIAL_AGENT_CATALOG } from "./agent-catalog.js";
import { effectiveAgentTools } from "./agent-policy.js";

describe("effectiveAgentTools", () => {
  it("uses the reviewed role policy when the runtime has no narrower allowlist", () => {
    expect(effectiveAgentTools(INITIAL_AGENT_CATALOG, "brain")).not.toContain("git_push");
    expect(effectiveAgentTools(INITIAL_AGENT_CATALOG, "brain")).not.toContain("schedule_create");
  });

  it("allows runtime configuration to narrow, but never expand, role authority", () => {
    expect(
      effectiveAgentTools(INITIAL_AGENT_CATALOG, "brain", ["workspace_read", "schedule_create"])
    ).toEqual(["workspace_read"]);
  });

  it("keeps Orchestrator free of shell and network tools", () => {
    expect(effectiveAgentTools(INITIAL_AGENT_CATALOG, "orchestrator")).toEqual([
      "workspace_list",
      "workspace_read",
      "workspace_write",
      "workspace_edit",
      "workspace_grep",
      "delegate",
      "delegate_status"
    ]);
  });

  it("keeps the focused roles within their reviewed tool boundaries", () => {
    expect(effectiveAgentTools(INITIAL_AGENT_CATALOG, "document-analyzer")).not.toContain("bash");
    expect(effectiveAgentTools(INITIAL_AGENT_CATALOG, "brain")).not.toContain("schedule_create");
    expect(effectiveAgentTools(INITIAL_AGENT_CATALOG, "brain")).not.toContain("schedule_update");
    expect(effectiveAgentTools(INITIAL_AGENT_CATALOG, "brain")).not.toContain("schedule_delete");
    expect(effectiveAgentTools(INITIAL_AGENT_CATALOG, "brain")).not.toContain("schedule_run_now");
    expect(effectiveAgentTools(INITIAL_AGENT_CATALOG, "brain")).not.toContain("time_now");
    expect(effectiveAgentTools(INITIAL_AGENT_CATALOG, "scheduler")).toEqual([
      "schedule_list",
      "schedule_create",
      "schedule_update",
      "schedule_delete",
      "schedule_run_now",
      "time_now"
    ]);
  });
});
