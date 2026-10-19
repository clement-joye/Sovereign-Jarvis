import { describe, expect, it, vi } from "vitest";

import { MatrixSyncClient } from "./matrix-sync.js";

describe("MatrixSyncClient", () => {
  it("processes joined-room timeline events and advances the sync cursor after acceptance", async () => {
    const process = vi.fn().mockResolvedValue({ status: "submitted" });
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          next_batch: "batch-1",
          rooms: {
            join: { "!brain:matrix.test": { timeline: { events: [{ event_id: "$one" }] } } }
          }
        })
      )
      .mockResolvedValueOnce(jsonResponse({ next_batch: "batch-2" }));
    const client = new MatrixSyncClient({
      homeserverUrl: "http://matrix.test/",
      accessToken: "token",
      processor: { process },
      fetchFn,
      timeoutMs: 100
    });

    await client.syncOnce();
    await client.syncOnce();

    expect(process).toHaveBeenCalledWith({ event_id: "$one", room_id: "!brain:matrix.test" });
    expect(fetchUrl(fetchFn.mock.calls[0]?.[0])).toBe(
      "http://matrix.test/_matrix/client/v3/sync?timeout=100"
    );
    expect(fetchUrl(fetchFn.mock.calls[1]?.[0])).toBe(
      "http://matrix.test/_matrix/client/v3/sync?timeout=100&since=batch-1"
    );
  });

  it("does not advance the sync cursor when event acceptance fails", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          next_batch: "batch-1",
          rooms: {
            join: { "!brain:matrix.test": { timeline: { events: [{ event_id: "$one" }] } } }
          }
        })
      )
      .mockResolvedValueOnce(jsonResponse({ next_batch: "batch-2" }));
    const client = new MatrixSyncClient({
      homeserverUrl: "http://matrix.test",
      accessToken: "token",
      processor: { process: vi.fn().mockRejectedValue(new Error("control unavailable")) },
      fetchFn
    });

    await expect(client.syncOnce()).rejects.toThrow("control unavailable");
    await client.syncOnce();

    expect(fetchUrl(fetchFn.mock.calls[1]?.[0])).not.toContain("since=batch-1");
  });

  it("reports a failed event stage using only its allowlisted media type", async () => {
    const onEventFailure = vi.fn();
    const client = new MatrixSyncClient({
      homeserverUrl: "http://matrix.test",
      accessToken: "token",
      processor: { process: vi.fn() },
      prepareEvent: vi.fn().mockRejectedValue(new Error("private media URL must not be logged")),
      onEventFailure,
      fetchFn: vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({
          next_batch: "batch-1",
          rooms: {
            join: {
              "!private-room:matrix.test": {
                timeline: {
                  events: [
                    {
                      event_id: "$private-event",
                      content: { msgtype: "m.file", url: "mxc://private/media-id" }
                    }
                  ]
                }
              }
            }
          }
        })
      )
    });

    await expect(client.syncOnce()).rejects.toThrow("private media URL must not be logged");
    expect(onEventFailure).toHaveBeenCalledExactlyOnceWith({ stage: "prepare", msgtype: "m.file" });
  });

  it("prepares each event before passing it to the gateway processor", async () => {
    const process = vi.fn().mockResolvedValue({ status: "submitted" });
    const prepareEvent = vi.fn().mockResolvedValue({ event_id: "$prepared" });
    const client = new MatrixSyncClient({
      homeserverUrl: "http://matrix.test",
      accessToken: "token",
      processor: { process },
      prepareEvent,
      fetchFn: vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({
          next_batch: "batch-1",
          rooms: {
            join: { "!brain:matrix.test": { timeline: { events: [{ event_id: "$raw" }] } } }
          }
        })
      )
    });

    await client.syncOnce();

    expect(prepareEvent).toHaveBeenCalledWith({ event_id: "$raw", room_id: "!brain:matrix.test" });
    expect(process).toHaveBeenCalledWith({ event_id: "$prepared" });
  });

  it("forwards membership state from the invited-room stream without treating it as a message", async () => {
    const process = vi.fn().mockResolvedValue({ status: "submitted" });
    const processMembership = vi.fn().mockResolvedValue(undefined);
    const client = new MatrixSyncClient({
      homeserverUrl: "http://matrix.test",
      accessToken: "token",
      processor: { process },
      membershipProcessor: { processMembership },
      fetchFn: vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({
          next_batch: "batch-1",
          rooms: {
            invite: {
              "!project:matrix.test": {
                invite_state: {
                  events: [
                    {
                      event_id: "$invite",
                      type: "m.room.member",
                      sender: "@owner:matrix.test",
                      state_key: "@brain:matrix.test",
                      content: { membership: "invite" }
                    }
                  ]
                }
              }
            }
          }
        })
      )
    });

    await client.syncOnce();

    expect(processMembership).toHaveBeenCalledWith({
      event_id: "$invite",
      type: "m.room.member",
      sender: "@owner:matrix.test",
      state_key: "@brain:matrix.test",
      content: { membership: "invite" },
      room_id: "!project:matrix.test"
    });
    expect(process).not.toHaveBeenCalled();
  });

  it("forwards membership events in joined rooms before their timeline event is processed", async () => {
    const calls: string[] = [];
    const client = new MatrixSyncClient({
      homeserverUrl: "http://matrix.test",
      accessToken: "token",
      processor: {
        process: vi.fn().mockImplementation(async () => {
          calls.push("message");
          return { status: "ignored" };
        })
      },
      membershipProcessor: {
        processMembership: vi.fn().mockImplementation(async () => {
          calls.push("membership");
        })
      },
      fetchFn: vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({
          next_batch: "batch-1",
          rooms: {
            join: {
              "!project:matrix.test": {
                timeline: {
                  events: [{ event_id: "$join", type: "m.room.member", content: {} }]
                }
              }
            }
          }
        })
      )
    });

    await client.syncOnce();

    expect(calls).toEqual(["membership", "message"]);
  });

  it("forwards the brain user's leave event from the left-room stream", async () => {
    const processMembership = vi.fn().mockResolvedValue(undefined);
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({
        next_batch: "next",
        rooms: {
          leave: {
            "!project:example": {
              timeline: {
                events: [
                  {
                    type: "m.room.member",
                    event_id: "$kicked",
                    sender: "@owner:example",
                    state_key: "@brain:example",
                    content: { membership: "leave" }
                  }
                ]
              }
            }
          }
        }
      })
    );
    const client = new MatrixSyncClient({
      homeserverUrl: "http://matrix.test",
      accessToken: "token",
      processor: { process: vi.fn() },
      membershipProcessor: { processMembership },
      fetchFn
    });

    await client.syncOnce();

    expect(processMembership).toHaveBeenCalledWith(
      expect.objectContaining({
        room_id: "!project:example",
        state_key: "@brain:example",
        content: { membership: "leave" }
      })
    );
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

function fetchUrl(input: unknown): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  if (input instanceof Request) {
    return input.url;
  }
  throw new Error("Expected fetch to receive a URL.");
}
