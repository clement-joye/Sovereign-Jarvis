import { describe, expect, it } from "vitest";

import { parseOpaquePathParameter } from "./path-parameters.js";

describe("parseOpaquePathParameter", () => {
  it("decodes a valid single opaque path segment", () => {
    expect(parseOpaquePathParameter("schedule%2D1")).toBe("schedule-1");
  });

  it("rejects absent, malformed, and multi-segment identifiers", () => {
    expect(parseOpaquePathParameter(undefined)).toBeUndefined();
    expect(parseOpaquePathParameter("")).toBeUndefined();
    expect(parseOpaquePathParameter("%E0%A4%A")).toBeUndefined();
    expect(parseOpaquePathParameter("schedule-1/history")).toBeUndefined();
    expect(parseOpaquePathParameter("schedule-1%2Fhistory")).toBeUndefined();
  });
});
