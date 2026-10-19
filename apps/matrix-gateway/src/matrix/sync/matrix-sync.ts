import type { MatrixGatewayProcessor } from "@second-brain/matrix-adapter";

import type { MatrixMembershipProcessor } from "../membership/matrix-membership.js";

export interface MatrixSyncClientOptions {
  homeserverUrl: string;
  accessToken: string;
  processor: Pick<MatrixGatewayProcessor, "process">;
  membershipProcessor?: MatrixMembershipProcessor;
  prepareEvent?: (event: unknown) => Promise<unknown>;
  onEventFailure?: (failure: { stage: "prepare" | "process"; msgtype?: string }) => void;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export class MatrixSyncClient {
  private readonly homeserverUrl: string;
  private readonly accessToken: string;
  private readonly processor: Pick<MatrixGatewayProcessor, "process">;
  private readonly membershipProcessor: MatrixMembershipProcessor | undefined;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly prepareEvent: (event: unknown) => Promise<unknown>;
  private readonly onEventFailure: MatrixSyncClientOptions["onEventFailure"];
  private since: string | undefined;

  constructor(options: MatrixSyncClientOptions) {
    this.homeserverUrl = options.homeserverUrl.replace(/\/$/, "");
    this.accessToken = options.accessToken;
    this.processor = options.processor;
    this.membershipProcessor = options.membershipProcessor;
    this.fetchFn = options.fetchFn ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 25_000;
    this.prepareEvent = options.prepareEvent ?? (async (event) => event);
    this.onEventFailure = options.onEventFailure;
  }

  async syncOnce(): Promise<void> {
    const url = new URL(`${this.homeserverUrl}/_matrix/client/v3/sync`);
    url.searchParams.set("timeout", String(this.timeoutMs));
    if (this.since) {
      url.searchParams.set("since", this.since);
    }

    const response = await this.fetchFn(url, {
      headers: { authorization: `Bearer ${this.accessToken}` }
    });
    if (!response.ok) {
      throw new Error(`Matrix sync failed: ${response.status}`);
    }

    const sync = (await response.json()) as MatrixSyncResponse;
    await this.processJoinedRooms(sync.rooms?.join);
    await this.processMembershipRooms(sync.rooms?.invite, (room) => room.invite_state?.events);
    await this.processMembershipRooms(sync.rooms?.leave, (room) => room.timeline?.events);
    if (typeof sync.next_batch === "string") {
      this.since = sync.next_batch;
    }
  }

  private async processMembership(event: unknown): Promise<void> {
    if (this.membershipProcessor && isRecord(event) && event.type === "m.room.member") {
      await this.membershipProcessor.processMembership(event);
    }
  }

  private async processJoinedRooms(
    rooms: Record<string, { timeline?: { events?: unknown[] } }> | undefined
  ): Promise<void> {
    for (const [roomId, room] of Object.entries(rooms ?? {})) {
      for (const event of room.timeline?.events ?? []) {
        const contextualEvent = withRoomId(event, roomId);
        await this.processMembership(contextualEvent);
        let preparedEvent: unknown;
        try {
          preparedEvent = await this.prepareEvent(contextualEvent);
        } catch (error) {
          this.onEventFailure?.({ stage: "prepare", ...eventMsgtype(contextualEvent) });
          throw error;
        }
        try {
          await this.processor.process(preparedEvent);
        } catch (error) {
          this.onEventFailure?.({ stage: "process", ...eventMsgtype(contextualEvent) });
          throw error;
        }
      }
    }
  }

  private async processMembershipRooms(
    rooms:
      | Record<string, { timeline?: { events?: unknown[] }; invite_state?: { events?: unknown[] } }>
      | undefined,
    eventsFor: (room: {
      timeline?: { events?: unknown[] };
      invite_state?: { events?: unknown[] };
    }) => unknown[] | undefined
  ): Promise<void> {
    for (const [roomId, room] of Object.entries(rooms ?? {})) {
      for (const event of eventsFor(room) ?? [])
        await this.processMembership(withRoomId(event, roomId));
    }
  }
}

function withRoomId(event: unknown, roomId: string): unknown {
  return isRecord(event) ? { ...event, room_id: roomId } : event;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function eventMsgtype(event: unknown): { msgtype?: string } {
  if (!isRecord(event) || !isRecord(event.content)) return {};
  const msgtype = event.content.msgtype;
  return typeof msgtype === "string" &&
    ["m.text", "m.notice", "m.emote", "m.image", "m.audio", "m.file"].includes(msgtype)
    ? { msgtype }
    : {};
}

interface MatrixSyncResponse {
  next_batch?: unknown;
  rooms?: {
    join?: Record<string, { timeline?: { events?: unknown[] } }>;
    invite?: Record<string, { invite_state?: { events?: unknown[] } }>;
    leave?: Record<string, { timeline?: { events?: unknown[] } }>;
  };
}
