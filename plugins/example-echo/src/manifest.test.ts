import { describe, expect, it } from "vitest";
import { EXAMPLE_ECHO_PLUGIN_MANIFEST_V2 } from "./manifest.js";

describe("example echo plugin", () => {
  it("is a valid secretless workspace plugin", () => {
    expect(EXAMPLE_ECHO_PLUGIN_MANIFEST_V2.agents[0]?.id).toBe("echo");
    expect(EXAMPLE_ECHO_PLUGIN_MANIFEST_V2.brokerProviders).toHaveLength(0);
    expect(Object.isFrozen(EXAMPLE_ECHO_PLUGIN_MANIFEST_V2)).toBe(true);
  });
});
