export interface MatrixTypingIndicator {
  start(input: { traceId: string; roomId: string; threadRootExternalEventId?: string }): void;
  stop(traceId: string): void;
  stopThread(input: { roomId: string; threadRootExternalEventId?: string }): void;
  stopAll?(): void;
}

export interface MatrixTypingIndicatorOptions {
  homeserverUrl: string;
  accessToken: string;
  userId: string;
  timeoutMs?: number;
  refreshMs?: number;
  maxDurationMs?: number;
  onError?: (error: unknown) => void;
}

interface ActiveTypingIndicator {
  roomId: string;
  threadRootExternalEventId?: string;
  refreshTimer: ReturnType<typeof setInterval>;
  expiryTimer: ReturnType<typeof setTimeout>;
}

/**
 * Matrix typing notifications are ephemeral and room-scoped. Refreshing the
 * notification keeps it visible while an interactive request is in progress;
 * the maximum duration prevents a stale indicator after an unexpected failure.
 */
export class MatrixTypingNotifier implements MatrixTypingIndicator {
  private readonly homeserverUrl: string;
  private readonly accessToken: string;
  private readonly userId: string;
  private readonly timeoutMs: number;
  private readonly refreshMs: number;
  private readonly maxDurationMs: number;
  private readonly onError: (error: unknown) => void;
  private readonly active = new Map<string, ActiveTypingIndicator>();
  private readonly roomUpdates = new Map<string, Promise<void>>();

  constructor(options: MatrixTypingIndicatorOptions) {
    this.homeserverUrl = options.homeserverUrl.replace(/\/$/, "");
    this.accessToken = options.accessToken;
    this.userId = options.userId;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.refreshMs = options.refreshMs ?? 20_000;
    this.maxDurationMs = options.maxDurationMs ?? 600_000;
    this.onError = options.onError ?? (() => undefined);
  }

  start(input: { traceId: string; roomId: string; threadRootExternalEventId?: string }): void {
    if (this.active.has(input.traceId)) return;

    const refreshTimer = setInterval(() => {
      void this.update(input.roomId, true);
    }, this.refreshMs);
    const expiryTimer = setTimeout(() => this.stop(input.traceId), this.maxDurationMs);
    this.active.set(input.traceId, {
      roomId: input.roomId,
      ...(input.threadRootExternalEventId
        ? { threadRootExternalEventId: input.threadRootExternalEventId }
        : {}),
      refreshTimer,
      expiryTimer
    });
    void this.update(input.roomId, true);
  }

  stop(traceId: string): void {
    const active = this.active.get(traceId);
    if (!active) return;

    this.active.delete(traceId);
    clearInterval(active.refreshTimer);
    clearTimeout(active.expiryTimer);
    if (![...this.active.values()].some(({ roomId }) => roomId === active.roomId)) {
      void this.update(active.roomId, false);
    }
  }

  stopThread(input: { roomId: string; threadRootExternalEventId?: string }): void {
    for (const [traceId, active] of this.active) {
      if (
        active.roomId === input.roomId &&
        active.threadRootExternalEventId === input.threadRootExternalEventId
      ) {
        this.stop(traceId);
      }
    }
  }

  stopAll(): void {
    for (const traceId of this.active.keys()) {
      this.stop(traceId);
    }
  }

  private update(roomId: string, typing: boolean): Promise<void> {
    const previous = this.roomUpdates.get(roomId) ?? Promise.resolve();
    const next = previous.then(() => this.sendUpdate(roomId, typing));
    this.roomUpdates.set(roomId, next);
    void next.then(() => {
      if (this.roomUpdates.get(roomId) === next) this.roomUpdates.delete(roomId);
    });
    return next;
  }

  private async sendUpdate(roomId: string, typing: boolean): Promise<void> {
    if (typing && ![...this.active.values()].some((active) => active.roomId === roomId)) return;
    try {
      const response = await fetch(
        `${this.homeserverUrl}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/typing/${encodeURIComponent(this.userId)}`,
        {
          method: "PUT",
          headers: {
            authorization: `Bearer ${this.accessToken}`,
            "content-type": "application/json"
          },
          body: JSON.stringify(
            typing ? { typing: true, timeout: this.timeoutMs } : { typing: false }
          )
        }
      );
      if (!response.ok) {
        throw new Error(`Matrix typing update failed with HTTP ${response.status}.`);
      }
    } catch (error) {
      this.onError(error);
    }
  }
}

export const noOpMatrixTypingIndicator: MatrixTypingIndicator = {
  start: () => undefined,
  stop: () => undefined,
  stopThread: () => undefined,
  stopAll: () => undefined
};
