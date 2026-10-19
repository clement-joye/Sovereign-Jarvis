import { describe, expect, it } from "vitest";
import { INITIAL_AGENT_CATALOG } from "@second-brain/domain";
import { RouterService } from "./router-service.js";

describe("RouterService", () => {
  it("classifies deterministic focused intents without performing work", () => {
    const router = new RouterService(INITIAL_AGENT_CATALOG);
    expect(router.route("Remind me tomorrow")).toMatchObject({
      primaryAgentId: "scheduler",
      confidence: 0.95
    });
    expect(router.route("Review this PDF attachment")).toMatchObject({
      primaryAgentId: "document-analyzer"
    });
    expect(router.route("Fix the TypeScript test")).toMatchObject({ primaryAgentId: "brain" });
  });
  it("falls back to Brain at low confidence", () => {
    expect(
      new RouterService(INITIAL_AGENT_CATALOG).route("What should I think about today?")
    ).toMatchObject({
      primaryAgentId: "brain",
      confidence: 0.35
    });
  });
  it("routes a multi-step plan to Orchestrator when available", () => {
    const router = new RouterService(INITIAL_AGENT_CATALOG);
    expect(router.route("Plan and coordinate this multi-step project")).toMatchObject({
      primaryAgentId: "orchestrator",
      confidence: 0.9
    });
    expect(router.route("Plan and coordinate this multi-step project", ["brain"])).toMatchObject({
      primaryAgentId: "brain"
    });
  });
  it("omits catalog agents that are inactive for the workspace", () => {
    expect(
      new RouterService(INITIAL_AGENT_CATALOG).route("Commit this repository", ["brain"])
    ).toMatchObject({ primaryAgentId: "brain" });
  });
});
