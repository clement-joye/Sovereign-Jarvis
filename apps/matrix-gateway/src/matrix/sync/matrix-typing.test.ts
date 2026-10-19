import { afterEach, describe, expect, it, vi } from "vitest";

import { MatrixTypingNotifier } from "./matrix-typing.js";

describe("MatrixTypingNotifier", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("starts, refreshes, and stops the native Matrix typing indicator", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const notifier = new MatrixTypingNotifier({
      homeserverUrl: "https://matrix.example/",
      accessToken: "token",
      userId: "@jarvis:example",
      timeoutMs: 30_000,
      refreshMs: 20_000,
      maxDurationMs: 60_000
    });

    notifier.start({ traceId: "trace-1", roomId: "!room:example" });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://matrix.example/_matrix/client/v3/rooms/!room%3Aexample/typing/%40jarvis%3Aexample",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ typing: true, timeout: 30_000 })
      })
    );

    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    notifier.stop("trace-1");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ body: JSON.stringify({ typing: false }) })
    );
  });

  it("expires a pending indicator to avoid stale typing state", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const notifier = new MatrixTypingNotifier({
      homeserverUrl: "https://matrix.example",
      accessToken: "token",
      userId: "@jarvis:example",
      refreshMs: 120_000,
      maxDurationMs: 10_000
    });

    notifier.start({ traceId: "trace-1", roomId: "!room:example" });
    await vi.advanceTimersByTimeAsync(10_000);

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      body: JSON.stringify({ typing: false })
    });
  });

  it("clears only the cancelled thread while another thread is active in the room", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const notifier = new MatrixTypingNotifier({
      homeserverUrl: "https://matrix.example",
      accessToken: "token",
      userId: "@jarvis:example"
    });

    notifier.start({ traceId: "first", roomId: "!room:example", threadRootExternalEventId: "$a" });
    notifier.start({ traceId: "second", roomId: "!room:example", threadRootExternalEventId: "$b" });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    notifier.stopThread({ roomId: "!room:example", threadRootExternalEventId: "$a" });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    notifier.stopThread({ roomId: "!room:example", threadRootExternalEventId: "$b" });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({
      body: JSON.stringify({ typing: false })
    });
  });

  it("sends typing false after an in-flight typing true request", async () => {
    let releaseFirst!: (response: Response) => void;
    const first = new Promise<Response>((resolve) => {
      releaseFirst = resolve;
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockReturnValueOnce(first)
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const notifier = new MatrixTypingNotifier({
      homeserverUrl: "https://matrix.example",
      accessToken: "token",
      userId: "@jarvis:example"
    });

    notifier.start({ traceId: "first", roomId: "!room:example" });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    notifier.stop("first");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    releaseFirst(new Response(null, { status: 200 }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      body: JSON.stringify({ typing: false })
    });
  });

  it("stops all active indicators during gateway shutdown", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const notifier = new MatrixTypingNotifier({
      homeserverUrl: "https://matrix.example",
      accessToken: "token",
      userId: "@jarvis:example"
    });

    notifier.start({ traceId: "trace-1", roomId: "!one:example" });
    notifier.start({ traceId: "trace-2", roomId: "!two:example" });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    notifier.stopAll();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(fetchMock.mock.calls.slice(2).map(([, options]) => options)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ body: JSON.stringify({ typing: false }) }),
        expect.objectContaining({ body: JSON.stringify({ typing: false }) })
      ])
    );
  });
});
