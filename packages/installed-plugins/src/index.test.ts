import { describe, expect, it, vi } from "vitest";

import {
  INSTALLED_PI_TOOL_PROVIDERS,
  INSTALLED_PLUGIN_PACKAGES,
  INSTALLED_PLUGIN_BROKER_PROVIDER_IDS_V2,
  INSTALLED_PLUGIN_MANIFESTS_V2,
  createInstalledPrivilegedBrokerHandlers
} from "./index.js";

describe("installed plugin composition", () => {
  it("keeps one immutable source for manifests and implementations", () => {
    expect(INSTALLED_PLUGIN_MANIFESTS_V2.map(({ id }) => id)).toEqual([
      "core-agents",
      "browser",
      "example-echo"
    ]);
    expect(INSTALLED_PLUGIN_BROKER_PROVIDER_IDS_V2).toEqual([
      "planner-delegation-control",
      "schedule-control",
      "browser-control"
    ]);
    expect(INSTALLED_PI_TOOL_PROVIDERS.map(({ implementationId }) => implementationId)).toEqual([
      "browser-tools",
      "browser-control",
      "example-echo-tools"
    ]);
    expect(
      INSTALLED_PLUGIN_PACKAGES.flatMap(({ brokerHandlerFactories }) =>
        brokerHandlerFactories.map(({ implementationId }) => implementationId)
      )
    ).toEqual(["browser-control"]);
    expect(
      createInstalledPrivilegedBrokerHandlers({
        environment: {},
        executeRuntimeAction: vi.fn()
      })
    ).toHaveLength(1);
    expect(Object.isFrozen(INSTALLED_PLUGIN_MANIFESTS_V2)).toBe(true);
  });

  it("validates generic plugin runtime configuration before handler registration", () => {
    expect(() =>
      createInstalledPrivilegedBrokerHandlers({
        environment: { JARVIS_PLUGIN_RUNTIME_CONFIG: "not-json" },
        executeRuntimeAction: vi.fn()
      })
    ).toThrow("valid JSON");
    expect(() =>
      createInstalledPrivilegedBrokerHandlers({
        environment: { JARVIS_PLUGIN_CREDENTIALS: '{"browser":"secret"}' },
        executeRuntimeAction: vi.fn()
      })
    ).toThrow("Plugin credentials must be an object: browser");
  });
});
