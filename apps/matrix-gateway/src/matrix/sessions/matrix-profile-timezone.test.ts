import { describe, expect, it, vi } from "vitest";

import { MatrixProfileTimezoneClient } from "./matrix-profile-timezone.js";

describe("MatrixProfileTimezoneClient", () => {
  it("reads and validates Matrix's m.tz profile field", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ "m.tz": "America/New_York" }), { status: 200 })
      );
    const client = new MatrixProfileTimezoneClient({
      homeserverUrl: "https://matrix.example/",
      accessToken: "token",
      fetchFn
    });

    await expect(client.get("@owner:matrix.example")).resolves.toBe("America/New_York");
    expect(fetchFn).toHaveBeenCalledWith(
      "https://matrix.example/_matrix/client/v3/profile/%40owner%3Amatrix.example/m.tz",
      { headers: { authorization: "Bearer token" } }
    );
  });

  it("falls back when the profile field is absent, malformed, or unavailable", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("", { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ "m.tz": "not/a-timezone" })))
      .mockRejectedValueOnce(new Error("offline"));
    const client = new MatrixProfileTimezoneClient({
      homeserverUrl: "https://matrix.example",
      accessToken: "token",
      fetchFn
    });

    await expect(client.get("@owner:matrix.example")).resolves.toBeUndefined();
    await expect(client.get("@owner:matrix.example")).resolves.toBeUndefined();
    await expect(client.get("@owner:matrix.example")).resolves.toBeUndefined();
  });
});
