import { describe, expect, it, vi } from "vitest";
import { assertAgentCatalogCompatibleAtStartup } from "./agent-catalog-startup.js";

describe("agent catalog startup compatibility", () => {
  it("allows immediate success", async () => {
    const check = vi.fn().mockResolvedValue(undefined);
    await expect(assertAgentCatalogCompatibleAtStartup(check)).resolves.toBeUndefined();
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("retries transient connection refusal", async () => {
    const check = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("refused"), { code: "ECONNREFUSED" }))
      .mockResolvedValueOnce(undefined);
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(
      assertAgentCatalogCompatibleAtStartup(check, { maxAttempts: 3, sleep })
    ).resolves.toBeUndefined();
    expect(check).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("immediately rethrows non-transient incompatibility", async () => {
    const error = new Error("catalog digest mismatch");
    const check = vi.fn().mockRejectedValue(error);
    await expect(assertAgentCatalogCompatibleAtStartup(check, { sleep: vi.fn() })).rejects.toBe(
      error
    );
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("rethrows a transient error at the attempt limit", async () => {
    const error = Object.assign(new Error("refused"), { code: "ECONNREFUSED" });
    const check = vi.fn().mockRejectedValue(error);
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(
      assertAgentCatalogCompatibleAtStartup(check, { maxAttempts: 2, sleep })
    ).rejects.toBe(error);
    expect(check).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });
});
