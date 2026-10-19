import { beforeEach, describe, expect, it, vi } from "vitest";

const client = {
  crypto: {
    prepare: vi.fn(),
    isRecoveryAvailable: vi.fn().mockResolvedValue(true),
    confirmIdentityWithRecoveryKey: vi.fn()
  },
  on: vi.fn(),
  sendMessage: vi.fn(),
  start: vi.fn(),
  stop: vi.fn()
};

vi.mock("@matrix-org/matrix-sdk-crypto-nodejs", () => ({
  StoreType: { Sqlite: 0 }
}));

vi.mock("@vector-im/matrix-bot-sdk", () => ({
  MatrixClient: vi.fn(() => client),
  RustSdkCryptoStorageProvider: vi.fn(),
  SimpleFsStorageProvider: vi.fn()
}));

import { MatrixE2eeClient } from "./matrix-e2ee-client.js";

describe("MatrixE2eeClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    client.crypto.prepare.mockResolvedValue(undefined);
    client.crypto.isRecoveryAvailable.mockResolvedValue(true);
    client.crypto.confirmIdentityWithRecoveryKey.mockResolvedValue(undefined);
    client.start.mockResolvedValue(undefined);
  });

  it("opens persistent crypto state before starting the sync loop", async () => {
    const processor = { process: vi.fn().mockResolvedValue({ status: "submitted" }) };
    const e2ee = new MatrixE2eeClient({
      homeserverUrl: "http://matrix.example",
      accessToken: "token",
      cryptoStorePath: "/brain/matrix-crypto",
      processor,
      onError: vi.fn()
    });

    await e2ee.start();

    expect(client.crypto.prepare).toHaveBeenCalledOnce();
    expect(client.start).toHaveBeenCalledOnce();
    const roomMessageHandler = client.on.mock.calls.find(
      ([eventName]) => eventName === "room.message"
    )?.[1] as (roomId: string, event: unknown) => void;
    roomMessageHandler("!brain:example", {
      type: "m.room.message",
      content: { msgtype: "m.text", body: "hello" }
    });
    await vi.waitFor(() => {
      expect(processor.process).toHaveBeenCalledWith({
        type: "m.room.message",
        content: { msgtype: "m.text", body: "hello" },
        room_id: "!brain:example"
      });
    });
  });

  it("sends replies through the crypto-capable Matrix client", async () => {
    client.sendMessage.mockResolvedValue("$reply");
    const e2ee = new MatrixE2eeClient({
      homeserverUrl: "http://matrix.example",
      accessToken: "token",
      cryptoStorePath: "/brain/matrix-crypto",
      processor: { process: vi.fn() },
      onError: vi.fn()
    });

    await expect(
      e2ee.sendMessage("!brain:example", { msgtype: "m.text", body: "hello" }, "txn-1")
    ).resolves.toEqual({ event_id: "$reply" });
    expect(client.sendMessage).toHaveBeenCalledWith("!brain:example", {
      msgtype: "m.text",
      body: "hello"
    });
  });

  it("forwards Matrix invite events to the lifecycle processor", async () => {
    const processMembership = vi.fn().mockResolvedValue(undefined);
    const e2ee = new MatrixE2eeClient({
      homeserverUrl: "http://matrix.example",
      accessToken: "token",
      cryptoStorePath: "/brain/matrix-crypto",
      processor: { process: vi.fn() },
      membershipProcessor: { processMembership },
      onError: vi.fn()
    });

    await e2ee.start();

    const inviteHandler = client.on.mock.calls.find(
      ([eventName]) => eventName === "room.invite"
    )?.[1] as (roomId: string, event: unknown) => void;
    inviteHandler("!project:example", { type: "m.room.member", content: { membership: "invite" } });
    await vi.waitFor(() => {
      expect(processMembership).toHaveBeenCalledWith({
        type: "m.room.member",
        content: { membership: "invite" },
        room_id: "!project:example"
      });
    });
  });

  it("cross-signs the persistent device when a recovery key is configured", async () => {
    const e2ee = new MatrixE2eeClient({
      homeserverUrl: "http://matrix.example",
      accessToken: "token",
      cryptoStorePath: "/brain/matrix-crypto",
      recoveryKey: "recovery-key",
      processor: { process: vi.fn() },
      onError: vi.fn()
    });

    await e2ee.start();

    expect(client.crypto.confirmIdentityWithRecoveryKey).toHaveBeenCalledWith("recovery-key");
  });

  it("can retry startup after a transient failure without duplicate event handlers", async () => {
    client.crypto.prepare.mockRejectedValueOnce(new Error("homeserver unavailable"));
    const e2ee = new MatrixE2eeClient({
      homeserverUrl: "http://matrix.example",
      accessToken: "token",
      cryptoStorePath: "/brain/matrix-crypto",
      processor: { process: vi.fn() },
      onError: vi.fn()
    });

    await expect(e2ee.start()).rejects.toThrow("homeserver unavailable");
    await expect(e2ee.start()).resolves.toBeUndefined();

    expect(client.on.mock.calls.filter(([event]) => event === "room.message")).toHaveLength(1);
  });
});
