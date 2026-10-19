import { describe, expect, it, vi } from "vitest";

import { MatrixRoomMembershipClient, MatrixTrustedInviteProcessor } from "./matrix-membership.js";

describe("MatrixTrustedInviteProcessor", () => {
  it("joins and persists an invitation from the trusted owner to Jarvis", async () => {
    const joinRoom = vi.fn().mockResolvedValue(undefined);
    const acceptTrustedInvite = vi.fn().mockResolvedValue({ created: true });
    const processor = new MatrixTrustedInviteProcessor({
      ownerMatrixId: "@owner:example",
      brainUserId: "@brain:example",
      joiner: { joinRoom },
      inviteAccepter: { acceptTrustedInvite }
    });

    await processor.processMembership(inviteEvent());

    expect(joinRoom).toHaveBeenCalledWith("!project:example");
    expect(acceptTrustedInvite).toHaveBeenCalledWith("!project:example");
    expect(joinRoom.mock.invocationCallOrder[0]).toBeLessThan(
      acceptTrustedInvite.mock.invocationCallOrder[0]!
    );
  });

  it("ignores invitations not sent by the trusted owner or not targeted at Jarvis", async () => {
    const joinRoom = vi.fn();
    const acceptTrustedInvite = vi.fn();
    const processor = new MatrixTrustedInviteProcessor({
      ownerMatrixId: "@owner:example",
      brainUserId: "@brain:example",
      joiner: { joinRoom },
      inviteAccepter: { acceptTrustedInvite }
    });

    await processor.processMembership({ ...inviteEvent(), sender: "@intruder:example" });
    await processor.processMembership({ ...inviteEvent(), state_key: "@other-bot:example" });
    await processor.processMembership({ ...inviteEvent(), content: { membership: "join" } });

    expect(joinRoom).not.toHaveBeenCalled();
    expect(acceptTrustedInvite).not.toHaveBeenCalled();
  });

  it("coalesces concurrent delivery of the same invitation", async () => {
    let releaseJoin: (() => void) | undefined;
    const joinRoom = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseJoin = resolve;
        })
    );
    const acceptTrustedInvite = vi.fn().mockResolvedValue({ created: true });
    const processor = new MatrixTrustedInviteProcessor({
      ownerMatrixId: "@owner:example",
      brainUserId: "@brain:example",
      joiner: { joinRoom },
      inviteAccepter: { acceptTrustedInvite }
    });

    const first = processor.processMembership(inviteEvent());
    const second = processor.processMembership(inviteEvent());
    await vi.waitFor(() => expect(joinRoom).toHaveBeenCalledOnce());
    releaseJoin?.();
    await Promise.all([first, second]);

    expect(acceptTrustedInvite).toHaveBeenCalledOnce();
  });

  it("archives a workspace when Jarvis is kicked or banned", async () => {
    const archiveRoom = vi.fn().mockResolvedValue(undefined);
    const processor = new MatrixTrustedInviteProcessor({
      ownerMatrixId: "@owner:example",
      brainUserId: "@brain:example",
      joiner: { joinRoom: vi.fn() },
      inviteAccepter: { acceptTrustedInvite: vi.fn() },
      archiver: { archiveRoom }
    });

    await processor.processMembership({ ...inviteEvent(), content: { membership: "leave" } });
    await processor.processMembership({ ...inviteEvent(), content: { membership: "ban" } });

    expect(archiveRoom).toHaveBeenCalledTimes(2);
    expect(archiveRoom).toHaveBeenCalledWith("!project:example");
  });
});

describe("MatrixRoomMembershipClient", () => {
  it("joins a Matrix room through the client API", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 200 }));
    const client = new MatrixRoomMembershipClient("http://matrix.test/", "token", fetchFn);

    await client.joinRoom("!project:example");

    expect(fetchFn).toHaveBeenCalledWith(
      "http://matrix.test/_matrix/client/v3/join/!project%3Aexample",
      expect.objectContaining({
        method: "POST",
        headers: { authorization: "Bearer token" },
        body: "{}"
      })
    );
  });
});

function inviteEvent(): Record<string, unknown> {
  return {
    type: "m.room.member",
    sender: "@owner:example",
    state_key: "@brain:example",
    room_id: "!project:example",
    content: { membership: "invite" }
  };
}
