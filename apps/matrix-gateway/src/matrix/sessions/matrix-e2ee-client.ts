import { join } from "node:path";

import { StoreType } from "@matrix-org/matrix-sdk-crypto-nodejs";
import {
  MatrixClient,
  RustSdkCryptoStorageProvider,
  SimpleFsStorageProvider,
  type EncryptedFile
} from "@vector-im/matrix-bot-sdk";

import type { MatrixGatewayProcessor } from "@second-brain/matrix-adapter";

import type { MatrixMembershipProcessor } from "../membership/matrix-membership.js";

export interface MatrixE2eeClientOptions {
  homeserverUrl: string;
  accessToken: string;
  cryptoStorePath: string;
  recoveryKey?: string;
  processor: Pick<MatrixGatewayProcessor, "process">;
  membershipProcessor?: MatrixMembershipProcessor;
  prepareEvent?: (event: unknown, decryptMedia: MatrixMediaDecryptor) => Promise<unknown>;
  onError: (error: unknown) => void;
  onProcessed?: (result: unknown) => void;
}

export type MatrixMediaDecryptor = (file: EncryptedFile) => Promise<Uint8Array>;

/**
 * Uses the Node-native Matrix Rust crypto store. Its SQLite state is retained
 * under `cryptoStorePath`, preserving the brain account's device identity and
 * room keys across gateway restarts.
 */
export class MatrixE2eeClient {
  private readonly client: MatrixClient;
  private readonly processor: Pick<MatrixGatewayProcessor, "process">;
  private readonly membershipProcessor: MatrixMembershipProcessor | undefined;
  private readonly prepareEvent: (
    event: unknown,
    decryptMedia: MatrixMediaDecryptor
  ) => Promise<unknown>;
  private readonly onError: (error: unknown) => void;
  private readonly onProcessed: ((result: unknown) => void) | undefined;
  private readonly recoveryKey: string | undefined;
  private eventHandlersRegistered = false;
  private started = false;

  constructor(options: MatrixE2eeClientOptions) {
    const syncStore = new SimpleFsStorageProvider(join(options.cryptoStorePath, "sync.json"));
    const cryptoStore = new RustSdkCryptoStorageProvider(
      join(options.cryptoStorePath, "crypto"),
      StoreType.Sqlite
    );
    this.client = new MatrixClient(
      options.homeserverUrl,
      options.accessToken,
      syncStore,
      cryptoStore
    );
    this.processor = options.processor;
    this.membershipProcessor = options.membershipProcessor;
    this.prepareEvent = options.prepareEvent ?? (async (event) => event);
    this.onError = options.onError;
    this.onProcessed = options.onProcessed;
    this.recoveryKey = options.recoveryKey;
  }

  async start(): Promise<void> {
    if (this.started) return;
    if (!this.eventHandlersRegistered) {
      this.client.on("room.message", (roomId: string, event: unknown) => {
        void this.processRoomMessage(roomId, event).catch(this.onError);
      });
      if (this.membershipProcessor) {
        this.client.on("room.invite", (roomId: string, event: unknown) => {
          void this.membershipProcessor
            ?.processMembership(isRecord(event) ? { ...event, room_id: roomId } : event)
            .catch(this.onError);
        });
      }
      this.eventHandlersRegistered = true;
    }
    await this.client.crypto.prepare();
    if (this.recoveryKey) {
      if (!(await this.client.crypto.isRecoveryAvailable())) {
        throw new Error(
          "MATRIX_RECOVERY_KEY is set, but Matrix secret storage and cross-signing are not initialized. Run the E2EE bootstrap command first."
        );
      }
      await this.client.crypto.confirmIdentityWithRecoveryKey(this.recoveryKey);
    }
    await this.client.start();
    this.started = true;
  }

  async sendMessage(
    roomId: string,
    content: Record<string, unknown>,
    transactionId: string
  ): Promise<{ event_id: string }> {
    // matrix-bot-sdk currently generates the Matrix transaction ID internally.
    // Keep this argument so the existing outbound port remains stable.
    void transactionId;
    return { event_id: await this.client.sendMessage(roomId, content) };
  }

  stop(): void {
    this.client.stop();
  }

  private async processRoomMessage(roomId: string, event: unknown): Promise<void> {
    if (!isRecord(event)) {
      return;
    }
    const result = await this.processor.process(
      await this.prepareEvent({ ...event, room_id: roomId }, (file) =>
        this.client.crypto.decryptMedia(file)
      )
    );
    this.onProcessed?.(result);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
