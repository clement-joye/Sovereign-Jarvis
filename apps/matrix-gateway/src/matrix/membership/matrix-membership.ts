export interface MatrixMembershipProcessor {
  processMembership(event: unknown): Promise<void>;
}

export interface MatrixRoomJoiner {
  joinRoom(roomId: string): Promise<void>;
}

export interface TrustedWorkspaceInviteAccepter {
  acceptTrustedInvite(roomId: string): Promise<{ created: boolean }>;
}

export interface WorkspaceRoomArchiver {
  archiveRoom(roomId: string): Promise<void>;
}

/** Minimal Matrix client for lifecycle actions that do not need the crypto SDK. */
export class MatrixRoomMembershipClient implements MatrixRoomJoiner {
  constructor(
    private readonly homeserverUrl: string,
    private readonly accessToken: string,
    private readonly fetchFn: typeof fetch = fetch
  ) {}

  async joinRoom(roomId: string): Promise<void> {
    const response = await this.fetchFn(
      `${this.homeserverUrl.replace(/\/$/, "")}/_matrix/client/v3/join/${encodeURIComponent(roomId)}`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${this.accessToken}` },
        body: "{}"
      }
    );
    if (!response.ok) {
      throw new Error(`Matrix room join failed: ${response.status}`);
    }
  }
}

/**
 * Admits only an invite sent by the configured owner to this Jarvis account.
 * It joins first so the control plane cannot create a workspace for a room
 * Jarvis failed to enter.
 */
export class MatrixTrustedInviteProcessor implements MatrixMembershipProcessor {
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(
    private readonly options: {
      ownerMatrixId: string;
      brainUserId: string;
      joiner: MatrixRoomJoiner;
      inviteAccepter: TrustedWorkspaceInviteAccepter;
      archiver?: WorkspaceRoomArchiver;
    }
  ) {}

  async processMembership(event: unknown): Promise<void> {
    const roomId = trustedInviteRoomId(event, this.options.ownerMatrixId, this.options.brainUserId);
    if (!roomId) {
      const departedRoomId = departedWorkspaceRoomId(event, this.options.brainUserId);
      if (departedRoomId && this.options.archiver)
        await this.options.archiver.archiveRoom(departedRoomId);
      return;
    }

    const pending = this.inFlight.get(roomId);
    if (pending) return pending;

    const acceptance = this.accept(roomId);
    this.inFlight.set(roomId, acceptance);
    try {
      await acceptance;
    } finally {
      this.inFlight.delete(roomId);
    }
  }

  private async accept(roomId: string): Promise<void> {
    await this.options.joiner.joinRoom(roomId);
    await this.options.inviteAccepter.acceptTrustedInvite(roomId);
  }
}

function departedWorkspaceRoomId(event: unknown, brainUserId: string): string | undefined {
  if (!isRecord(event) || !isRecord(event.content)) return undefined;
  return event.type === "m.room.member" &&
    event.state_key === brainUserId &&
    (event.content.membership === "leave" || event.content.membership === "ban") &&
    typeof event.room_id === "string"
    ? event.room_id
    : undefined;
}

function trustedInviteRoomId(
  event: unknown,
  ownerMatrixId: string,
  brainUserId: string
): string | undefined {
  if (!isRecord(event) || !isRecord(event.content)) return undefined;
  return event.type === "m.room.member" &&
    event.sender === ownerMatrixId &&
    event.state_key === brainUserId &&
    event.content.membership === "invite" &&
    typeof event.room_id === "string"
    ? event.room_id
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
