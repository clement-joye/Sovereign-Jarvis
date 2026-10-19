import { describe, expect, it } from "vitest";

import { matrixSyncFailureKind } from "./matrix-sync-failure-kind.js";

describe("matrixSyncFailureKind", () => {
  it("classifies transport and HTTP failures without exposing the error text", () => {
    expect(matrixSyncFailureKind(new TypeError("private host name"))).toBe("network");
    expect(matrixSyncFailureKind(new Error("Matrix media download failed: 404"))).toBe("http");
    expect(matrixSyncFailureKind(new Error("private content and URL"))).toBe("other");
  });
});
