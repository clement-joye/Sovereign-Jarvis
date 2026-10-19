import { describe, expect, it } from "vitest";
import { resolveApprovedProfileResources } from "./profile-resource-policy.js";

describe("resolveApprovedProfileResources", () => {
  it("selects only reviewed SDK-compatible resources beneath the profile root", () => {
    expect(
      resolveApprovedProfileResources("/profile", [
        { path: "extensions/tool-gating/index.ts", compatibility: "sdk-compatible" },
        { path: "extensions/subagent/index.ts", compatibility: "unsuitable" }
      ])
    ).toEqual(["/profile/extensions/tool-gating/index.ts"]);
    expect(() =>
      resolveApprovedProfileResources("/profile", [
        { path: "../host-secret", compatibility: "sdk-compatible" }
      ])
    ).toThrow("escapes");
  });
});
