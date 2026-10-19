import { describe, expect, it, vi } from "vitest";

import { MatrixMediaClient } from "./matrix-media.js";

describe("MatrixMediaClient", () => {
  it("downloads bounded MXC media with its declared content type", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(Buffer.from("image"), {
        status: 200,
        headers: { "content-length": "5", "content-type": "image/png; charset=binary" }
      })
    );
    const client = new MatrixMediaClient({
      homeserverUrl: "https://matrix.test",
      accessToken: "token",
      maxDownloadBytes: 10,
      fetchFn
    });

    await expect(client.download("mxc://matrix.test/media-1")).resolves.toMatchObject({
      bytes: new Uint8Array(Buffer.from("image")),
      mediaType: "image/png"
    });
    expect(fetchFn.mock.calls[0]?.[0]).toBe(
      "https://matrix.test/_matrix/client/v1/media/download/matrix.test/media-1"
    );
    expect(fetchFn.mock.calls[0]?.[1]).toMatchObject({
      headers: { authorization: "Bearer token" }
    });
  });

  it("falls back to legacy media download only when the homeserver rejects the new route", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ errcode: "M_UNRECOGNIZED" }), { status: 404 })
      )
      .mockResolvedValueOnce(new Response(Buffer.from("text"), { status: 200 }));
    const client = new MatrixMediaClient({
      homeserverUrl: "https://matrix.test",
      accessToken: "token",
      maxDownloadBytes: 10,
      fetchFn
    });

    await expect(client.download("mxc://matrix.test/media-1")).resolves.toMatchObject({
      bytes: new Uint8Array(Buffer.from("text"))
    });
    expect(fetchFn.mock.calls.map(([url]) => url)).toEqual([
      "https://matrix.test/_matrix/client/v1/media/download/matrix.test/media-1",
      "https://matrix.test/_matrix/media/v3/download/matrix.test/media-1"
    ]);
  });

  it("does not use the legacy endpoint for a media-not-found response", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ errcode: "M_NOT_FOUND" }), { status: 404 })
      );
    const client = new MatrixMediaClient({
      homeserverUrl: "https://matrix.test",
      accessToken: "token",
      maxDownloadBytes: 10,
      fetchFn
    });

    await expect(client.download("mxc://matrix.test/media-1")).rejects.toThrow(
      "Matrix media download failed: 404"
    );
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("rejects oversized and malformed media downloads before they reach storage", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(Buffer.alloc(11), { status: 200, headers: { "content-length": "11" } })
      );
    const client = new MatrixMediaClient({
      homeserverUrl: "https://matrix.test",
      accessToken: "token",
      maxDownloadBytes: 10,
      fetchFn
    });

    await expect(client.download("mxc://matrix.test/media-1")).rejects.toThrow("download limit");
    await expect(client.download("https://matrix.test/media-1")).rejects.toThrow("mxc://");
  });

  it("uploads media and requires a valid MXC content URI", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ content_uri: "mxc://matrix.test/upload-1" }), { status: 200 })
      );
    const client = new MatrixMediaClient({
      homeserverUrl: "https://matrix.test",
      accessToken: "token",
      maxDownloadBytes: 10,
      fetchFn
    });

    await expect(
      client.upload({ bytes: Buffer.from("audio"), mediaType: "audio/ogg", filename: "reply.ogg" })
    ).resolves.toEqual({ contentUri: "mxc://matrix.test/upload-1" });
    expect(fetchFn.mock.calls[0]?.[0]).toBe(
      "https://matrix.test/_matrix/media/v3/upload?filename=reply.ogg"
    );
  });
});
