import { describe, expect, it } from "vitest";

import type { PostgresTransactionalClient } from "./transaction.js";
import { withTransaction } from "./transaction.js";

describe("withTransaction", () => {
  it("commits successful work and releases the client", async () => {
    const client = recordingClient();

    await expect(
      withTransaction({ connect: async () => client }, async () => "done")
    ).resolves.toBe("done");

    expect(client.queries).toEqual(["BEGIN", "COMMIT"]);
    expect(client.released).toBe(true);
  });

  it("rolls back failures, releases the client, and preserves the original error", async () => {
    const client = recordingClient({ failRollback: true });
    const original = new Error("work failed");

    await expect(
      withTransaction({ connect: async () => client }, async () => {
        throw original;
      })
    ).rejects.toBe(original);

    expect(client.queries).toEqual(["BEGIN", "ROLLBACK"]);
    expect(client.released).toBe(true);
  });
});

function recordingClient(input: { failRollback?: boolean } = {}): PostgresTransactionalClient & {
  queries: string[];
  released: boolean;
} {
  return {
    queries: [],
    released: false,
    async query(text) {
      this.queries.push(text);
      if (input.failRollback && text === "ROLLBACK") {
        throw new Error("rollback failed");
      }
      return { rows: [], rowCount: 0, command: "", oid: 0, fields: [] };
    },
    release() {
      this.released = true;
    }
  };
}
